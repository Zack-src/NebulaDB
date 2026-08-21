import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Committed regression coverage for the 2026-08-20 data-loss bug (see
 * `docs/perf/multiuser-concurrency-2026-08-20.md` and `docs/todo.md` Phase
 * 6): two users on the same project, one editing the canvas while the
 * other's DBML panel resyncs with a stale buffer, used to have the stale
 * buffer's `/import` delete whatever the other person had just added.
 *
 * `preserveConcurrentAdditions` itself (the merge function) already has
 * focused unit tests in `packages/dbml-engine/src/concurrentEdits.test.ts`.
 * This file is the piece that was missing: the *route* — `POST
 * /api/projects/:id/import` — wired to a real `Room`'s live doc, the way an
 * actual DBML-panel resync calls it. The original verification for this bug
 * was two live browser tabs and a throwaway Playwright script; this is that
 * scenario, committed.
 */
process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-concurrency-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
process.env.ATHANORDB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../../app.js");
const { db } = await import("../../../infrastructure/db.js");
const { hashPassword } = await import("../../auth/password.js");
const { getRoom, closeAllRooms } = await import("../../../realtime/roomRegistry.js");
const { writeProjectToDoc, readProjectFromDoc } = await import("@athanordb/shared");
const { projectToDbml } = await import("@athanordb/dbml-engine");

const HOST = "localhost:3001";
const ORIGIN = `http://${HOST}`;

function headers(extra: Record<string, string> = {}) {
  return { host: HOST, origin: ORIGIN, ...extra };
}

async function loginAs(app: Awaited<ReturnType<typeof buildApp>>, email: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", headers: headers(), payload: { email, password } });
  const sessionCookie = res.cookies.find((c) => c.name === "athanordb_sid");
  return `athanordb_sid=${sessionCookie!.value}`;
}

async function makeUser() {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, 0, NULL)").run(
    id,
    email,
    await hashPassword(password),
  );
  return { id, email, password };
}

async function makeProject(app: Awaited<ReturnType<typeof buildApp>>, cookie: string) {
  const res = await app.inject({ method: "POST", url: "/api/projects", headers: headers({ cookie }), payload: { name: "Concurrency check" } });
  return res.json() as { id: string; name: string };
}

/** Alice's and Bob's shared starting point: one table, two fields. */
function baseProject(projectId: string, projectName: string) {
  return {
    id: projectId,
    name: projectName,
    tables: [
      {
        id: "t-widgets",
        name: "widgets",
        fields: [
          { id: "t-widgets.id", name: "id", type: "integer", pk: true },
          { id: "t-widgets.label", name: "label", type: "varchar" },
        ],
        indexes: [],
        position: { x: 0, y: 0 },
        detailLevel: "standard" as const,
      },
    ],
    refs: [],
    enums: [],
    zones: [],
    stickyNotes: [],
    tableGroups: [],
  };
}

/** Writes a project state straight into the room's live doc — simulates a canvas edit from *any* connected client, bypassing the WebSocket exactly like `seedCanvasTable` does in `connections/routes.test.ts`. */
function writeCanvasState(projectId: string, project: ReturnType<typeof baseProject>) {
  const room = getRoom(projectId);
  room.doc.transact(() => writeProjectToDoc(room.doc, project), "test-canvas-edit");
}

test("Bob's concurrent canvas edit survives Alice's stale DBML-panel resync (the actual 2026-08-20 bug)", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const cookie = await loginAs(app, owner.email, owner.password);
    const project = await makeProject(app, cookie);

    // Both Alice's and Bob's clients start from this state.
    const shared = baseProject(project.id, project.name);
    writeCanvasState(project.id, shared);
    const aliceBaseline = projectToDbml(shared);
    // Alice's buffer is untouched (dirty === false), so her "source" on
    // resync is identical to her baseline — exactly what
    // `DbmlPanel.tsx`/`setup.ts` sends for an unedited buffer.
    const aliceSource = aliceBaseline;

    // Bob, meanwhile, adds a column on the canvas — a real concurrent edit,
    // written directly to the room the same way `Room.receive()` would apply
    // one arriving over the WebSocket.
    const withBobsColumn = {
      ...shared,
      tables: [
        {
          ...shared.tables[0],
          fields: [...shared.tables[0].fields, { id: "t-widgets.created_at", name: "created_at", type: "timestamp" }],
        },
      ],
    };
    writeCanvasState(project.id, withBobsColumn);

    // Alice's panel now resyncs its (stale) buffer.
    const resync = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/import`,
      headers: headers({ cookie }),
      payload: { source: aliceSource, baseline: aliceBaseline },
    });
    assert.equal(resync.statusCode, 200);

    const finalState = readProjectFromDoc(getRoom(project.id).doc, project.id, project.name);
    const fieldNames = finalState.tables[0].fields.map((f) => f.name);
    assert.deepEqual(
      fieldNames.sort(),
      ["created_at", "id", "label"],
      "Bob's concurrently-added column must survive Alice's stale resync",
    );
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("Alice's own deletion still applies — concurrent-edit protection doesn't resurrect what she actually removed", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const cookie = await loginAs(app, owner.email, owner.password);
    const project = await makeProject(app, cookie);

    const shared = baseProject(project.id, project.name);
    writeCanvasState(project.id, shared);
    const baseline = projectToDbml(shared);

    // Alice deletes the `label` field in her DBML buffer — present in the
    // baseline, absent from what she's about to send.
    const withoutLabel = {
      ...shared,
      tables: [{ ...shared.tables[0], fields: shared.tables[0].fields.filter((f) => f.name !== "label") }],
    };
    const aliceSource = projectToDbml(withoutLabel);

    const resync = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/import`,
      headers: headers({ cookie }),
      payload: { source: aliceSource, baseline },
    });
    assert.equal(resync.statusCode, 200);

    const finalState = readProjectFromDoc(getRoom(project.id).doc, project.id, project.name);
    const fieldNames = finalState.tables[0].fields.map((f) => f.name);
    assert.deepEqual(fieldNames.sort(), ["id"], "a field genuinely removed by the importing client must stay removed");
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("Alice creating a table in DBML survives Bob's concurrent canvas resync in the other direction", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const cookie = await loginAs(app, owner.email, owner.password);
    const project = await makeProject(app, cookie);

    const shared = baseProject(project.id, project.name);
    writeCanvasState(project.id, shared);
    const baseline = projectToDbml(shared);

    // Alice types a whole new table into the DBML panel.
    const withNewTable = {
      ...shared,
      tables: [
        ...shared.tables,
        {
          id: "t-orders",
          name: "orders",
          fields: [{ id: "t-orders.id", name: "id", type: "integer", pk: true }],
          indexes: [],
          position: { x: 300, y: 0 },
          detailLevel: "standard" as const,
        },
      ],
    };
    const aliceSource = projectToDbml(withNewTable);

    const resync = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/import`,
      headers: headers({ cookie }),
      payload: { source: aliceSource, baseline },
    });
    assert.equal(resync.statusCode, 200);

    const finalState = readProjectFromDoc(getRoom(project.id).doc, project.id, project.name);
    assert.deepEqual(
      finalState.tables.map((t) => t.name).sort(),
      ["orders", "widgets"],
      "Alice's table typed in DBML must appear even though it was applied through the merge-by-baseline path",
    );
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("an import with no baseline (import dialog, a script, an older client) keeps the old replace-everything behaviour", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const cookie = await loginAs(app, owner.email, owner.password);
    const project = await makeProject(app, cookie);

    const shared = baseProject(project.id, project.name);
    writeCanvasState(project.id, shared);

    // Someone else's concurrent addition, same as the first test...
    const withBobsColumn = {
      ...shared,
      tables: [
        {
          ...shared.tables[0],
          fields: [...shared.tables[0].fields, { id: "t-widgets.created_at", name: "created_at", type: "timestamp" }],
        },
      ],
    };
    writeCanvasState(project.id, withBobsColumn);

    // ...but this import carries no baseline at all — the plain Import
    // dialog's shape, which is a deliberate, one-off "this file is now the
    // schema" action, not a resync.
    const plainImport = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/import`,
      headers: headers({ cookie }),
      payload: { source: projectToDbml(shared) },
    });
    assert.equal(plainImport.statusCode, 200);

    const finalState = readProjectFromDoc(getRoom(project.id).doc, project.id, project.name);
    assert.deepEqual(
      finalState.tables[0].fields.map((f) => f.name).sort(),
      ["id", "label"],
      "without a baseline, import replaces the schema wholesale — this is the documented, intentional exception",
    );
  } finally {
    closeAllRooms();
    await app.close();
  }
});
