import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import v8 from "node:v8";
import vm from "node:vm";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync.js";
import * as encoding from "lib0/encoding.js";
import type { WebSocket } from "ws";
import { useTestDatabase } from "../infrastructure/testDatabase.js";

// What a synchronous store used to guarantee by itself, and now has to be
// arranged: one room per project, revisions in the order they were made, a
// reopened project that has everything its last room wrote.
await useTestDatabase("roomregistry");

const { db } = await import("../infrastructure/db.js");
const { closeAllRooms, closeRoom, getRoom, liveRoomCount, peekRoom, sweepIdleRooms } =
  await import("./roomRegistry.js");
const { latestRevisionId, listRevisions } = await import("./persistence.js");
const { deleteProjectCascade } = await import("../modules/projects/repository.js");

async function newProject(): Promise<string> {
  const id = randomUUID();
  await db.prepare("INSERT INTO projects (id, name) VALUES (?, ?)").run(id, "registry test");
  return id;
}

function fakeSocket(): WebSocket {
  let closed = false;
  return {
    OPEN: 1,
    get readyState() {
      return closed ? 3 : 1;
    },
    send() {},
    close() {
      closed = true;
    },
  } as unknown as WebSocket;
}

/** A client frame that sets `key` in the doc's `meta` map. */
function setMeta(key: string, value: string): Uint8Array {
  const client = new Y.Doc();
  client.getMap("meta").set(key, value);
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0); // MESSAGE_SYNC
  syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(client));
  return encoding.toUint8Array(encoder);
}

test("a project opened from several places at once gets one room", async (t) => {
  t.after(closeAllRooms);
  const projectId = await newProject();
  // A browser tab connecting while a REST call reads the same project: with
  // two rooms, each would hold a doc the other's edits never reach.
  const rooms = await Promise.all(Array.from({ length: 8 }, () => getRoom(projectId)));
  assert.ok(rooms.every((room) => room === rooms[0]));
  assert.equal(peekRoom(projectId), rooms[0]);
});

test("revisions are stored in the order the changes were made", async (t) => {
  t.after(closeAllRooms);
  const projectId = await newProject();
  const room = await getRoom(projectId);
  // Each change queues an insert; sent to the pool all at once they could be
  // numbered in any order, and a history replayed out of order is another history.
  const authors = Array.from({ length: 40 }, (_, i) => `author-${String(i).padStart(2, "0")}`);
  for (const author of authors) room.doc.transact(() => room.doc.getMap("meta").set("who", author), author);
  await room.flush();
  assert.deepEqual(
    (await listRevisions(projectId)).map((revision) => revision.author),
    authors,
  );
});

test("a change made through `write` is in the history by the time it resolves, under the id the room announced", async (t) => {
  t.after(closeAllRooms);
  const projectId = await newProject();
  const room = await getRoom(projectId);
  assert.equal(room.lastRevisionId, null);
  await room.write(() => room.doc.getMap("meta").set("name", "first"), "ada");
  assert.ok(room.lastRevisionId);
  assert.equal(await latestRevisionId(projectId), room.lastRevisionId);

  // A change that changes nothing makes no revision, and announces none.
  const before = room.lastRevisionId;
  await room.write(() => {}, "ada");
  assert.equal(room.lastRevisionId, before);
});

test("a project reopened the moment its last client left has everything that client wrote", async (t) => {
  t.after(closeAllRooms);
  const projectId = await newProject();
  const first = await getRoom(projectId);
  const socket = fakeSocket();
  await first.join(socket, "grace", () => ({ canWrite: true }));
  await first.receive(socket, setMeta("title", "kept"));

  // Not awaited: the snapshot the departure queues is still on its way when
  // the project is asked for again.
  const left = first.leave(socket);
  const second = await getRoom(projectId);
  assert.notEqual(second, first, "the emptied room was evicted");
  assert.equal(second.doc.getMap("meta").get("title"), "kept");
  await left;
});

test("frames are handled in the order they arrived, even when a permission has to be looked up first", async (t) => {
  t.after(closeAllRooms);
  const projectId = await newProject();
  const room = await getRoom(projectId);
  const socket = fakeSocket();
  let lookups = 0;
  await room.join(socket, "hedy", async () => {
    // The first lookup is the one `join` makes; the next is slow, as a busy database would make it.
    if (lookups++ > 0) await new Promise((resolve) => setTimeout(resolve, 40));
    return { canWrite: true };
  });
  // Ages the cached answer out, so the first frame below has to wait for a lookup.
  await room.revalidate();
  (room as unknown as { conns: Map<WebSocket, { accessCheckedAt: number }> }).conns.get(socket)!.accessCheckedAt = 0;

  const frames = ["one", "two", "three"].map((key) => room.receive(socket, setMeta(key, "set")));
  await Promise.all(frames);
  await room.flush();
  // Each frame came from a client doc of its own and touched a key of its
  // own, so each stored update can be read alone to see which frame it was.
  const rows = (await db
    .prepare("SELECT yjs_update FROM revisions WHERE project_id = ? ORDER BY seq")
    .all(projectId)) as { yjs_update: Buffer }[];
  const seen = rows.map((row) => {
    const one = new Y.Doc();
    Y.applyUpdate(one, new Uint8Array(row.yjs_update));
    return Array.from(one.getMap("meta").keys()).join();
  });
  assert.deepEqual(seen, ["one", "two", "three"]);
});

test("closing a room waits for what it was still storing, so its project can be deleted right after", async () => {
  const projectId = await newProject();
  const room = await getRoom(projectId);
  for (let i = 0; i < 20; i++) room.doc.transact(() => room.doc.getMap("meta").set("n", i), "ida");
  // Twenty inserts are queued. Deleting the project's rows while one of them
  // is in flight would fail on the foreign key — or leave a row behind.
  await closeRoom(projectId);
  await deleteProjectCascade(projectId);
  assert.equal(await db.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId), undefined);
  assert.equal(
    ((await db.prepare("SELECT COUNT(*) AS n FROM revisions WHERE project_id = ?").get(projectId)) as { n: number }).n,
    0,
  );
  assert.equal(peekRoom(projectId), undefined);
});

test("a socket that closes while it is being let in neither joins nor empties the room", async (t) => {
  t.after(closeAllRooms);
  const projectId = await newProject();
  const room = await getRoom(projectId);
  const staying = fakeSocket();
  await room.join(staying, "june", () => ({ canWrite: true }));

  const leaving = fakeSocket();
  const joining = room.join(leaving, "kay", async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { canWrite: true };
  });
  leaving.close();
  await room.leave(leaving);
  await joining;
  assert.deepEqual(room.presence(), ["june"]);
  assert.equal(peekRoom(projectId), room, "the room is still there for the client that stayed");
  assert.ok(liveRoomCount() >= 1);
});

// ---- Rooms opened by a REST call: nobody connects, so nobody ever leaves ---------------

const IDLE = 2 * 60_000;

/** Runs a garbage collection (the flag is turned on at runtime, so the test needs no special command line). */
async function collect(): Promise<void> {
  v8.setFlagsFromString("--expose-gc");
  const gc = vm.runInNewContext("gc") as () => void;
  for (let i = 0; i < 5; i++) {
    gc();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("a room opened only by a REST call stays resident until it is swept, and is then evicted", async (t) => {
  t.after(closeAllRooms);
  const before = liveRoomCount();
  const ids = await Promise.all(Array.from({ length: 5 }, newProject));
  await Promise.all(ids.map((id) => getRoom(id)));
  assert.equal(liveRoomCount(), before + 5);

  // Used a moment ago: left alone.
  assert.equal(sweepIdleRooms(Date.now(), IDLE), 0);
  assert.equal(liveRoomCount(), before + 5);

  // Idle for longer than the limit: gone.
  assert.equal(sweepIdleRooms(Date.now() + IDLE + 1, IDLE), 5);
  assert.equal(liveRoomCount(), before);
  for (const id of ids) assert.equal(peekRoom(id), undefined);
});

test("asking for a room again keeps it from being swept", async (t) => {
  t.after(closeAllRooms);
  const projectId = await newProject();
  await getRoom(projectId);
  const later = Date.now() + IDLE;
  // Asked for again just before the sweep.
  const originalNow = Date.now;
  Date.now = () => later - 1000;
  try {
    await getRoom(projectId);
  } finally {
    Date.now = originalNow;
  }
  assert.equal(sweepIdleRooms(later + 1, IDLE), 0);
  assert.ok(peekRoom(projectId));
});

test("a room with a client connected is never swept, however long it has been since it was asked for", async (t) => {
  t.after(closeAllRooms);
  const projectId = await newProject();
  const room = await getRoom(projectId);
  const socket = fakeSocket();
  await room.join(socket, "ada", () => ({ canWrite: true }));

  assert.equal(sweepIdleRooms(Date.now() + 10 * IDLE, IDLE), 0);
  assert.equal(peekRoom(projectId), room);

  // Once the client leaves, the usual eviction takes it (the sweep has nothing left to do).
  await room.leave(socket);
  assert.equal(peekRoom(projectId), undefined);
  assert.equal(sweepIdleRooms(Date.now() + 10 * IDLE, IDLE), 0);
});

test("a swept room has stored what a REST call wrote, and the project reopens with it", async (t) => {
  t.after(closeAllRooms);
  const projectId = await newProject();
  const room = await getRoom(projectId);
  await room.write(() => room.doc.getMap("meta").set("name", "written over REST"), "ada");

  assert.equal(sweepIdleRooms(Date.now() + IDLE + 1, IDLE), 1);
  await flushAndSettle(projectId);

  const reopened = await getRoom(projectId);
  assert.notEqual(reopened, room);
  assert.equal(reopened.doc.getMap("meta").get("name"), "written over REST");
});

test("a write to a swept room fails loudly instead of being lost", async (t) => {
  t.after(closeAllRooms);
  const projectId = await newProject();
  const room = await getRoom(projectId);
  sweepIdleRooms(Date.now() + IDLE + 1, IDLE);
  await assert.rejects(
    room.write(() => room.doc.getMap("meta").set("name", "late"), "ada"),
    /closed before/,
  );
});

/** Opens a project's room and hands back only a weak reference to its document, so this frame keeps nothing alive. */
async function openWatched(): Promise<WeakRef<object>> {
  const room = await getRoom(await newProject());
  room.doc.getMap("meta").set("payload", "x".repeat(10_000));
  return new WeakRef(room.doc);
}

test("swept rooms can be garbage collected: their documents are not kept alive", async (t) => {
  t.after(closeAllRooms);
  const refs: WeakRef<object>[] = [];
  for (let i = 0; i < 10; i++) refs.push(await openWatched());
  assert.equal(sweepIdleRooms(Date.now() + IDLE + 1, IDLE), 10);
  await flushAndSettle();
  await collect();
  const alive = refs.filter((ref) => ref.deref() !== undefined).length;
  assert.equal(alive, 0, `${alive} of ${refs.length} documents are still in memory after the sweep`);
});

test("rooms that are never swept are kept alive (the leak this guards against)", async (t) => {
  t.after(closeAllRooms);
  const refs: WeakRef<object>[] = [];
  for (let i = 0; i < 10; i++) refs.push(await openWatched());
  await collect();
  assert.equal(refs.filter((ref) => ref.deref() !== undefined).length, 10);
});

/** Waits for what evicted rooms still had to store, as `flushAllRooms` does at shutdown. */
async function flushAndSettle(_projectId?: string): Promise<void> {
  const { flushAllRooms } = await import("./roomRegistry.js");
  await flushAllRooms();
}
