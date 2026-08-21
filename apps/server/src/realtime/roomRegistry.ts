import { Room, type RoomLogger } from "./room.js";

/**
 * Every project's live `Room`, keyed by project id — resident only while at
 * least one client is connected (see `Room.leave`'s eviction). Split out from
 * `room.ts` so that file stays about *one room's* behaviour; this one is
 * about the registry of all of them.
 */
const rooms = new Map<string, Room>();

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

export function getRoom(projectId: string): Room {
  let room = rooms.get(projectId);
  if (!room) {
    room = new Room(projectId, () => rooms.delete(projectId), roomLogger);
    rooms.set(projectId, room);
  }
  return room;
}

/**
 * Snapshots every live room immediately. Called on SIGTERM/SIGINT: without it,
 * anything edited inside the last snapshot-debounce window is only in the
 * revision log and the in-memory doc, and dies with the process. Returns how
 * many rooms were flushed.
 */
export function flushAllRooms(): number {
  for (const room of rooms.values()) room.flush();
  return rooms.size;
}

/** Disconnects every client and drops every room — shutdown, after `flushAllRooms`. */
export function closeAllRooms(): void {
  for (const room of rooms.values()) room.destroy();
  rooms.clear();
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
export function revalidateRoom(projectId: string): void {
  rooms.get(projectId)?.revalidate();
}

/**
 * Re-checks access across every live room. Used when a change can affect
 * projects that can't be enumerated cheaply from the change itself — team
 * membership (a user may be in teams granted on many projects), or an account
 * being disabled or deleted. Only live rooms are visited, and each connection
 * costs one permission lookup, so this stays proportional to who is actually
 * connected right now rather than to how much data exists.
 */
export function revalidateAllRooms(): void {
  for (const room of rooms.values()) room.revalidate();
}

/** Tears down a project's in-memory room (if one is live) ahead of deleting its rows — see `Room.destroy`. */
export function closeRoom(projectId: string): void {
  const room = rooms.get(projectId);
  if (!room) return;
  room.destroy();
  rooms.delete(projectId);
}
