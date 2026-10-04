import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Y from "yjs";
import * as encoding from "lib0/encoding.js";
import * as decoding from "lib0/decoding.js";
import * as syncProtocol from "y-protocols/sync.js";
import type { WebSocket } from "ws";

process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-room-test-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";

const { db } = await import("../infrastructure/db.js");
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

  room.receive(
    socket,
    updateMessage((doc) => doc.getMap("tables").set("t1", "users")),
  );
  assert.equal(room.doc.getMap("tables").get("t1"), "users");
});

test("a read-only connection's update is dropped", (t) => {
  const room = newRoom(t);
  const { socket } = fakeSocket();
  room.join(socket, "bob", () => ({ canWrite: false }));

  room.receive(
    socket,
    updateMessage((doc) => doc.getMap("tables").set("t1", "users")),
  );
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

  room.receive(
    socket,
    updateMessage((doc) => doc.getMap("tables").set("before", "ok")),
  );
  assert.equal(room.doc.getMap("tables").get("before"), "ok");

  canWrite = false;
  room.revalidate(); // what the permission-changing routes call

  room.receive(
    socket,
    updateMessage((doc) => doc.getMap("tables").set("after", "nope")),
  );
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
  room.receive(
    socket,
    updateMessage((doc) => doc.getMap("tables").set("t1", "users")),
  );
  assert.equal(room.doc.getMap("tables").has("t1"), false, "an unresolvable permission is not treated as granted");
});

test("a connection that joins with no access starts read-only", (t) => {
  const room = newRoom(t);
  const { socket } = fakeSocket();
  room.join(socket, "frank", () => null);

  room.receive(
    socket,
    updateMessage((doc) => doc.getMap("tables").set("t1", "users")),
  );
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

test("loading a project saved with an inverted ref repairs it once, persistently, under its own author", async (t) => {
  const { writeProjectToDoc, getRefsMap } = await import("@athanordb/shared");
  const { saveSnapshot, listRevisions } = await import("./persistence.js");

  // A project as an older version stored an inline `posts.author_id [ref: > users.id]`:
  // `from` on the referenced key, `to` on the FK column.
  const projectId = newProject();
  const legacy = new Y.Doc();
  writeProjectToDoc(legacy, {
    id: projectId,
    name: "legacy",
    tables: [
      {
        id: "t-users",
        name: "users",
        fields: [{ id: "f-users-id", name: "id", type: "int", pk: true }],
        indexes: [],
        position: { x: 0, y: 0 },
        detailLevel: "full",
      },
      {
        id: "t-posts",
        name: "posts",
        fields: [
          { id: "f-posts-id", name: "id", type: "int", pk: true },
          { id: "f-posts-author", name: "author_id", type: "int" },
        ],
        indexes: [],
        position: { x: 400, y: 0 },
        detailLevel: "full",
      },
    ],
    refs: [
      {
        id: "r1",
        from: { tableId: "t-users", fieldId: "f-users-id" },
        to: { tableId: "t-posts", fieldId: "f-posts-author" },
        cardinality: "one-to-many",
      },
    ],
    enums: [],
    zones: [],
    stickyNotes: [],
    tableGroups: [],
  });
  saveSnapshot(projectId, legacy);

  const room = new Room(projectId, () => {});
  t.after(() => room.destroy());
  const repaired = getRefsMap(room.doc).get("r1")!;
  assert.deepEqual(repaired.from, { tableId: "t-posts", fieldId: "f-posts-author" });
  assert.deepEqual(repaired.to, { tableId: "t-users", fieldId: "f-users-id" });
  assert.ok(
    listRevisions(projectId).some((rev) => rev.author === "AthanorDB (sens des relations corrigé)"),
    "the repair is a recorded revision, not a silent in-memory change",
  );

  // A second load of the repaired state finds nothing to do.
  room.flush();
  const before = listRevisions(projectId).length;
  const again = new Room(projectId, () => {});
  t.after(() => again.destroy());
  assert.equal(listRevisions(projectId).length, before);
});

// --- Table locks -----------------------------------------------------------

function lockTestTable(id: string, name: string, columns: string[]) {
  return {
    id,
    name,
    fields: columns.map((column) => ({ id: `${id}.${column}`, name: column, type: "int" })),
    indexes: [],
    position: { x: 0, y: 0 },
    detailLevel: "full" as const,
  };
}

/** A room holding `users` and `orders`, with `orders.user_id` → `users.id`. */
function roomWithSchema(t: TestContext): InstanceType<typeof Room> {
  const room = newRoom(t);
  room.doc.transact(() => {
    const tables = room.doc.getMap("tables");
    tables.set("users", lockTestTable("users", "users", ["id", "email"]));
    tables.set("orders", lockTestTable("orders", "orders", ["id", "user_id"]));
    room.doc.getMap("refs").set("r1", {
      id: "r1",
      from: { tableId: "orders", fieldId: "orders.user_id" },
      to: { tableId: "users", fieldId: "users.id" },
      cardinality: "one-to-many",
    });
  }, "setup");
  return room;
}

/** A frame from a client that is in sync with the room, carrying only what `mutate` changed — what a real editor sends. */
function clientEdit(room: InstanceType<typeof Room>, mutate: (doc: Y.Doc) => void): Uint8Array {
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(room.doc));
  const before = Y.encodeStateVector(client);
  mutate(client);
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0); // MESSAGE_SYNC
  syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(client, before));
  return encoding.toUint8Array(encoder);
}

/** `Room` keeps its project id private; the revision log is the only way to see what it persisted. */
const roomProjectId = (room: InstanceType<typeof Room>) => (room as unknown as { projectId: string }).projectId;

type AnyTable = ReturnType<typeof lockTestTable> & { position: { x: number; y: number } };
const tableOf = (doc: Y.Doc, id: string) => doc.getMap("tables").get(id) as AnyTable | undefined;

/** The `ServerNotice`s (message type 2) a fake socket received. */
function noticesSent(sent: Uint8Array[]): unknown[] {
  return sent.flatMap((frame) => {
    const decoder = decoding.createDecoder(frame);
    return decoding.readVarUint(decoder) === 2 ? [JSON.parse(decoding.readVarString(decoder))] : [];
  });
}

test("a change to a locked table is put back, and the connection is told which table", (t) => {
  const room = roomWithSchema(t);
  const { socket, sent } = fakeSocket();
  room.join(socket, "erin", () => ({ canWrite: true, lockedTableIds: new Set(["users"]) }));

  room.receive(
    socket,
    clientEdit(room, (doc) => {
      const users = tableOf(doc, "users")!;
      doc.getMap("tables").set("users", {
        ...users,
        name: "customers",
        fields: [...users.fields, { id: "users.phone", name: "phone", type: "text" }],
        position: { x: 640, y: 120 },
      });
      // Same frame, an unlocked table: must survive.
      const orders = tableOf(doc, "orders")!;
      doc.getMap("tables").set("orders", { ...orders, name: "purchases" });
    }),
  );

  const users = tableOf(room.doc, "users")!;
  assert.equal(users.name, "users", "the rename is undone");
  assert.deepEqual(
    users.fields.map((field) => field.name),
    ["id", "email"],
    "the added column is gone",
  );
  assert.deepEqual(users.position, { x: 640, y: 120 }, "moving a locked table is allowed and kept");
  assert.equal(tableOf(room.doc, "orders")!.name, "purchases", "the unlocked table keeps its change");
  assert.deepEqual(noticesSent(sent), [{ type: "table-locked", tables: ["users"] }]);
});

test("deleting a locked table, or its foreign key, is put back", (t) => {
  const room = roomWithSchema(t);
  const { socket } = fakeSocket();
  room.join(socket, "erin", () => ({ canWrite: true, lockedTableIds: new Set(["orders"]) }));

  room.receive(
    socket,
    clientEdit(room, (doc) => doc.getMap("refs").delete("r1")),
  );
  assert.ok(room.doc.getMap("refs").has("r1"), "the locked table's foreign key is restored");

  room.receive(
    socket,
    clientEdit(room, (doc) => doc.getMap("tables").delete("orders")),
  );
  assert.equal(tableOf(room.doc, "orders")?.name, "orders", "the deleted table is restored");
});

test("moving a locked table, or editing another one, sends no notice and reverts nothing", async (t) => {
  const { listRevisions } = await import("./persistence.js");
  const room = roomWithSchema(t);
  const { socket, sent } = fakeSocket();
  room.join(socket, "erin", () => ({ canWrite: true, lockedTableIds: new Set(["users"]) }));
  const revisionsBefore = listRevisions(roomProjectId(room)).length;

  room.receive(
    socket,
    clientEdit(room, (doc) => {
      doc.getMap("tables").set("users", { ...tableOf(doc, "users")!, position: { x: 10, y: 20 } });
      doc.getMap("tables").set("audit", lockTestTable("audit", "audit", ["user_id"]));
      // A new table may point at a locked one: that alters the new table, not the locked one.
      doc.getMap("refs").set("r2", {
        id: "r2",
        from: { tableId: "audit", fieldId: "audit.user_id" },
        to: { tableId: "users", fieldId: "users.id" },
        cardinality: "one-to-many",
      });
    }),
  );

  assert.deepEqual(tableOf(room.doc, "users")!.position, { x: 10, y: 20 });
  assert.ok(room.doc.getMap("refs").has("r2"));
  assert.deepEqual(noticesSent(sent), []);
  assert.equal(listRevisions(roomProjectId(room)).length, revisionsBefore + 1, "one revision: the edit, no revert");
});

test("a lock binds only the connections it is resolved for, and lifting it takes effect on revalidate", (t) => {
  const room = roomWithSchema(t);
  const admin = fakeSocket();
  const editor = fakeSocket();
  let locked = new Set(["users"]);
  room.join(admin.socket, "admin", () => ({ canWrite: true }));
  room.join(editor.socket, "editor", () => ({ canWrite: true, lockedTableIds: locked }));

  const rename = (name: string) => (doc: Y.Doc) =>
    doc.getMap("tables").set("users", { ...tableOf(doc, "users")!, name });

  room.receive(admin.socket, clientEdit(room, rename("accounts")));
  assert.equal(tableOf(room.doc, "users")!.name, "accounts", "the administrator edits the locked table");

  room.receive(editor.socket, clientEdit(room, rename("people")));
  assert.equal(tableOf(room.doc, "users")!.name, "accounts", "the editor does not");

  locked = new Set();
  room.revalidate(); // what the lock routes call
  room.receive(editor.socket, clientEdit(room, rename("people")));
  assert.equal(tableOf(room.doc, "users")!.name, "people", "once unlocked, the editor does");

  room.announce({ type: "locks-changed" });
  assert.deepEqual(noticesSent(admin.sent).at(-1), { type: "locks-changed" });
});

test("a notice addressed to accounts reaches their connections only", (t) => {
  const room = newRoom(t);
  const ada = fakeSocket();
  const adaOtherTab = fakeSocket();
  const bob = fakeSocket();
  const unidentified = fakeSocket();
  room.join(ada.socket, "ada", () => ({ canWrite: true }), "user-ada");
  room.join(adaOtherTab.socket, "ada", () => ({ canWrite: true }), "user-ada");
  // Same display name as Ada: it is the account that is addressed, not the name.
  room.join(bob.socket, "ada", () => ({ canWrite: true }), "user-bob");
  room.join(unidentified.socket, "ada", () => ({ canWrite: true }));

  room.announceTo(new Set(["user-ada", "user-nobody-connected"]), { type: "notification" });

  assert.deepEqual(noticesSent(ada.sent), [{ type: "notification" }]);
  assert.deepEqual(noticesSent(adaOtherTab.sent), [{ type: "notification" }]);
  assert.deepEqual(noticesSent(bob.sent), []);
  assert.deepEqual(noticesSent(unidentified.sent), []);
});
