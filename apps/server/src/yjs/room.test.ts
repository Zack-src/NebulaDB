import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Y from "yjs";
import * as encoding from "lib0/encoding.js";
import * as syncProtocol from "y-protocols/sync.js";
import type { WebSocket } from "ws";

process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-room-test-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";

const { db } = await import("../db.js");
const { Room } = await import("./room.js");

/**
 * Enough of a WebSocket for `Room`: it only ever calls `send`, `close` and
 * reads `readyState`/`OPEN`. Using a stub rather than a real socket keeps this
 * a unit test of the permission logic instead of a networking test.
 */
function fakeSocket() {
  const sent: Uint8Array[] = [];
  let closed = false;
  const socket = {
    OPEN: 1,
    get readyState() {
      return closed ? 3 : 1;
    },
    send(data: Uint8Array) {
      sent.push(data);
    },
    close() {
      closed = true;
    },
  };
  return { socket: socket as unknown as WebSocket, sent, isClosed: () => closed };
}

function newProject(): string {
  const id = randomUUID();
  db.prepare("INSERT INTO projects (id, name) VALUES (?, ?)").run(id, "room test");
  return id;
}

/**
 * A room registered for teardown. Every `Room` starts an Awareness interval,
 * so a test that leaves one alive holds the whole process open — which is how
 * the eviction leak this file also covers was found in the first place.
 */
function newRoom(t: TestContext): InstanceType<typeof Room> {
  const room = new Room(newProject(), () => {});
  t.after(() => room.destroy());
  return room;
}

/** A client frame carrying a Yjs update — the same shape `yjsClient.ts` sends. */
function updateMessage(mutate: (doc: Y.Doc) => void): Uint8Array {
  const client = new Y.Doc();
  mutate(client);
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0); // MESSAGE_SYNC
  syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(client));
  return encoding.toUint8Array(encoder);
}

test("a writable connection's update is applied", (t) => {
  const room = newRoom(t);
  const { socket } = fakeSocket();
  room.join(socket, "alice", () => ({ canWrite: true }));

  room.receive(socket, updateMessage((doc) => doc.getMap("tables").set("t1", "users")));
  assert.equal(room.doc.getMap("tables").get("t1"), "users");
});

test("a read-only connection's update is dropped", (t) => {
  const room = newRoom(t);
  const { socket } = fakeSocket();
  room.join(socket, "bob", () => ({ canWrite: false }));

  room.receive(socket, updateMessage((doc) => doc.getMap("tables").set("t1", "users")));
  assert.equal(room.doc.getMap("tables").has("t1"), false, "a view-only socket cannot mutate the document");
});

test("revoking write access takes effect on an already-open connection", (t) => {
  // The bug this covers: `canWrite` used to be resolved once, at connect time,
  // and stored. Downgrading someone to view-only left them writing until they
  // happened to reconnect.
  const room = newRoom(t);
  const { socket } = fakeSocket();
  let canWrite = true;
  room.join(socket, "carol", () => ({ canWrite }));

  room.receive(socket, updateMessage((doc) => doc.getMap("tables").set("before", "ok")));
  assert.equal(room.doc.getMap("tables").get("before"), "ok");

  canWrite = false;
  room.revalidate(); // what the permission-changing routes call

  room.receive(socket, updateMessage((doc) => doc.getMap("tables").set("after", "nope")));
  assert.equal(room.doc.getMap("tables").has("after"), false, "the edit made after revocation is refused");
  assert.equal(room.doc.getMap("tables").get("before"), "ok", "edits made while allowed are untouched");
});

test("losing access entirely closes the connection", (t) => {
  const room = newRoom(t);
  const { socket, isClosed } = fakeSocket();
  let access: { canWrite: boolean } | null = { canWrite: true };
  room.join(socket, "dave", () => access);

  assert.equal(isClosed(), false);
  access = null; // removed from the only team granting the project
  room.revalidate();
  assert.equal(isClosed(), true, "a user with no permission left is disconnected, not silently downgraded");
});

test("a resolver that throws fails closed", (t) => {
  const room = newRoom(t);
  const { socket } = fakeSocket();
  let broken = false;
  room.join(socket, "erin", () => {
    if (broken) throw new Error("database is locked");
    return { canWrite: true };
  });

  broken = true;
  room.revalidate();
  room.receive(socket, updateMessage((doc) => doc.getMap("tables").set("t1", "users")));
  assert.equal(room.doc.getMap("tables").has("t1"), false, "an unresolvable permission is not treated as granted");
});

test("a connection that joins with no access starts read-only", (t) => {
  const room = newRoom(t);
  const { socket } = fakeSocket();
  room.join(socket, "frank", () => null);

  room.receive(socket, updateMessage((doc) => doc.getMap("tables").set("t1", "users")));
  assert.equal(room.doc.getMap("tables").has("t1"), false);
});

test("an evicted room releases its Awareness timer", () => {
  // Regression test for a leak found while writing this file: the last client
  // leaving evicts the room from the module's map, but `Awareness` holds a
  // `setInterval` of its own, so the timer — and through it the Awareness, the
  // Y.Doc and the entire project's contents — stayed alive for the life of the
  // process, for every project ever opened. The symptom that exposed it was
  // this test file never exiting.
  let evicted = false;
  const room = new Room(newProject(), () => {
    evicted = true;
  });
  const { socket } = fakeSocket();
  room.join(socket, "grace", () => ({ canWrite: true }));

  room.leave(socket);

  assert.equal(evicted, true, "the room is evicted when the last client leaves");
  // `Awareness.destroy()` clears its interval and emits `destroy`; observing
  // the doc's destroyed flag is the accessible proxy for "cleanup ran".
  assert.equal(room.doc.isDestroyed, true, "the document and its awareness timer are released");
});
