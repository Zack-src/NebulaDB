import type { ServerNotice } from "@nebuladb/shared";
import { Room, type RoomLogger } from "./room.js";

/**
 * Every project's live `Room`, keyed by project id — resident only while at
 * least one client is connected (see `Room.leave`'s eviction). Split out from
 * `room.ts` so that file stays about *one room's* behaviour; this one is
 * about the registry of all of them.
 */
const rooms = new Map<string, Room>();
/** Rooms being loaded: whoever asks for one meanwhile gets the same room, not a second one for the same project. */
const opening = new Map<string, Promise<Room>>();
/** What an evicted room still had to store. Its project is not reopened before that lands, or it would load the state from before. */
const settling = new Map<string, Promise<void>>();

/**
 * Falls back to `console` so a `Room` created before `setRoomLogger` runs
 * (or in a test that never calls it) still logs somewhere, but every real
 * boot sets this to `app.log` before the first WS connection can arrive —
 * see `buildApp()`. Module-level rather than threaded through every
 * `getRoom` call site: a `Room` outlives any single request that touches it
 * (many connections, many REST calls over its lifetime), so there is no one
 * request's logger to hand it — see `room.ts`'s `RoomLogger` doc for what
 * this does and doesn't buy in terms of correlation.
 */
let roomLogger: RoomLogger = console;

/** Called once from `buildApp()` so every `Room`'s own logs go through the same structured/JSON logger as the rest of the server, instead of plain `console` text with no `room` field to filter on. */
export function setRoomLogger(logger: RoomLogger): void {
  roomLogger = logger;
}

/**
 * The project's live room, loaded from its snapshot if nobody has it open.
 *
 * A room is evicted the moment its last client leaves, so use what this
 * returns straight away: after another `await`, ask again rather than keep
 * the reference — a write to an evicted room's doc reaches nobody and is
 * stored nowhere.
 */
export async function getRoom(projectId: string): Promise<Room> {
  const live = rooms.get(projectId);
  if (live) return live;
  let pending = opening.get(projectId);
  if (!pending) {
    pending = openRoom(projectId).finally(() => opening.delete(projectId));
    opening.set(projectId, pending);
  }
  return pending;
}

async function openRoom(projectId: string): Promise<Room> {
  await settling.get(projectId);
  const room = await Room.open(projectId, (settled) => evictRoom(projectId, room, settled), roomLogger);
  rooms.set(projectId, room);
  return room;
}

function evictRoom(projectId: string, room: Room, settled: Promise<void>): void {
  if (rooms.get(projectId) === room) rooms.delete(projectId);
  settling.set(projectId, settled);
  void settled.then(() => {
    if (settling.get(projectId) === settled) settling.delete(projectId);
  });
}

/** The live room for a project if one is resident, without creating one — for read-only callers that can fall back to the stored snapshot. */
export function peekRoom(projectId: string): Room | undefined {
  return rooms.get(projectId);
}

/**
 * Snapshots every live room immediately. Called on SIGTERM/SIGINT: without it,
 * anything edited inside the last snapshot-debounce window is only in the
 * revision log and the in-memory doc, and dies with the process. Returns how
 * many rooms were flushed, once they all are.
 */
export async function flushAllRooms(): Promise<number> {
  const flushed = Array.from(rooms.values(), (room) => room.flush());
  // Rooms emptied a moment ago may still be storing their last snapshot.
  await Promise.all([...flushed, ...settling.values()]);
  return flushed.length;
}

/** Disconnects every client and drops every room — shutdown, after `flushAllRooms`. */
export async function closeAllRooms(): Promise<void> {
  const closed = Array.from(rooms.values(), (room) => room.destroy());
  rooms.clear();
  await Promise.all(closed);
}

/** Number of projects currently resident in memory — reported by the health check. */
export function liveRoomCount(): number {
  return rooms.size;
}

/** Total live WebSocket connections across every room — for `/api/metrics`. */
export function totalConnectionCount(): number {
  let total = 0;
  for (const room of rooms.values()) total += room.connectionCount();
  return total;
}

/**
 * Re-checks access for every connection of one project. Call after changing
 * that project's team grants.
 */
export async function revalidateRoom(projectId: string): Promise<void> {
  await rooms.get(projectId)?.revalidate();
}

/**
 * Re-checks access across every live room. Used when a change can affect
 * projects that can't be enumerated cheaply from the change itself — team
 * membership (a user may be in teams granted on many projects), or an account
 * being disabled or deleted. Only live rooms are visited, and each connection
 * costs one permission lookup, so this stays proportional to who is actually
 * connected right now rather than to how much data exists.
 */
export async function revalidateAllRooms(): Promise<void> {
  await Promise.all(Array.from(rooms.values(), (room) => room.revalidate()));
}

/**
 * A table lock was placed, changed or lifted: every connection's set of
 * frozen tables is recomputed at once, and clients are told to refetch the
 * lock list so padlocks appear and disappear without a reload.
 */
export async function notifyLocksChanged(projectId: string): Promise<void> {
  const room = rooms.get(projectId);
  if (!room) return;
  await room.revalidate();
  room.announce({ type: "locks-changed" });
}

/** Pushes a notice to everyone who has this project open. A project nobody has open has nobody to tell. */
export function notifyProject(projectId: string, notice: ServerNotice): void {
  rooms.get(projectId)?.announce(notice);
}

/**
 * Pushes a notice to the given accounts' connections on this project, and to
 * no other connection of the room — see `Room.announceTo`.
 */
export function notifyProjectUsers(projectId: string, userIds: ReadonlySet<string>, notice: ServerNotice): void {
  if (userIds.size > 0) rooms.get(projectId)?.announceTo(userIds, notice);
}

/** Tears down a project's in-memory room (if one is live or loading) ahead of deleting its rows — see `Room.destroy`. */
export async function closeRoom(projectId: string): Promise<void> {
  const room = rooms.get(projectId) ?? (await opening.get(projectId));
  if (room) {
    rooms.delete(projectId);
    await room.destroy();
  }
  await settling.get(projectId);
}
