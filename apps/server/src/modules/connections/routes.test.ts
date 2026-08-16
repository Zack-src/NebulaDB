import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Same rationale as `app.test.ts`: env vars must land before anything
// transitively imports `db.ts`/`shared/crypto.ts`.
process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-connroutes-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
process.env.ATHANORDB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms, getRoom } = await import("../../realtime/room.js");
const { writeProjectToDoc } = await import("@athanordb/shared");

const HOST = "localhost:3001";
const ORIGIN = `http://${HOST}`;

function headers(extra: Record<string, string> = {}) {
  return { host: HOST, origin: ORIGIN, ...extra };
}

async function loginAs(app: Awaited<ReturnType<typeof buildApp>>, email: string, password: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password },
  });
  const sessionCookie = res.cookies.find((c) => c.name === "athanordb_sid");
  return `athanordb_sid=${sessionCookie!.value}`;
}

async function makeUser(isAdmin: 0 | 1 = 0) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?, NULL)").run(
    id,
    email,
    await hashPassword(password),
    isAdmin,
  );
  return { id, email, password };
}

/** Seeds the project's live canvas doc with a single table — bypasses the WebSocket entirely, using the same `writeProjectToDoc` the real sync path calls. */
function seedCanvasTable(projectId: string, projectName: string) {
  const room = getRoom(projectId);
  room.doc.transact(() => {
    writeProjectToDoc(room.doc, {
      id: projectId,
      name: projectName,
      tables: [
        {
          id: "t-widgets",
          name: "widgets",
          fields: [{ id: "t-widgets.id", name: "id", type: "integer", pk: true }],
          indexes: [],
          position: { x: 0, y: 0 },
          detailLevel: "standard",
        },
      ],
      refs: [],
      enums: [],
      zones: [],
      stickyNotes: [],
      tableGroups: [],
    });
  }, "test-seed");
}

test("deployment history + rollback: full lifecycle against a real SQLite target file", async () => {
  const app = await buildApp();
  const targetFile = join(tmpdir(), `athanordb-test-target-${randomUUID()}.sqlite`);
  try {
    const owner = await makeUser();
    const cookie = await loginAs(app, owner.email, owner.password);

    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: headers({ cookie }),
      payload: { name: "Deploy target project" },
    });
    const project = created.json();
    seedCanvasTable(project.id, project.name);

    const connRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/connections`,
      headers: headers({ cookie }),
      payload: { name: "Local file", engine: "sqlite", filePath: targetFile, environment: "test-env" },
    });
    assert.equal(connRes.statusCode, 200);
    const connId = connRes.json().connection.id;
    assert.equal(connRes.json().connection.environment, "test-env");

    // Plan: the live file is empty, the canvas has `widgets` -> a diff exists.
    const plan = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/connections/${connId}/plan-deployment`,
      headers: headers({ cookie }),
      payload: {},
    });
    assert.equal(plan.statusCode, 200);
    assert.equal(plan.json().diff.hasChanges, true);

    // Apply: creates `widgets` on the real target file.
    const apply = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/connections/${connId}/apply-deployment`,
      headers: headers({ cookie }),
      payload: { resolutions: {} },
    });
    assert.equal(apply.statusCode, 200);
    const applyBody = apply.json();
    assert.equal(applyBody.success, true);
    assert.equal(applyBody.rollbackAvailable, true);
    assert.deepEqual(applyBody.irreversibleWarnings, []);

    // History: one entry, rollback available, not yet rolled back.
    const historyAfterApply = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/connections/${connId}/history`,
      headers: headers({ cookie }),
    });
    assert.equal(historyAfterApply.statusCode, 200);
    const entries = historyAfterApply.json().history;
    assert.equal(entries.length, 1);
    const [deployEntry] = entries;
    assert.equal(deployEntry.success, true);
    assert.equal(deployEntry.environment, "test-env");
    assert.equal(deployEntry.engine, "sqlite");
    assert.ok(deployEntry.rollbackSql);
    assert.equal(deployEntry.rolledBack, false);
    assert.equal(deployEntry.executedByEmail, owner.email);

    // Re-planning against the now-changed target shows no more drift.
    const planAfterApply = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/connections/${connId}/plan-deployment`,
      headers: headers({ cookie }),
      payload: {},
    });
    assert.equal(planAfterApply.json().diff.hasChanges, false);

    // Roll it back.
    const rollback = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/connections/${connId}/history/${deployEntry.id}/rollback`,
      headers: headers({ cookie }),
      payload: {},
    });
    assert.equal(rollback.statusCode, 200);
    assert.equal(rollback.json().success, true);

    // The target file really lost the table — planning again shows the diff again.
    const planAfterRollback = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/connections/${connId}/plan-deployment`,
      headers: headers({ cookie }),
      payload: {},
    });
    assert.equal(planAfterRollback.json().diff.hasChanges, true, "the table should be gone from the live target again");

    // History now has two entries; the original is marked rolled back.
    const historyAfterRollback = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/connections/${connId}/history`,
      headers: headers({ cookie }),
    });
    const entriesAfterRollback = historyAfterRollback.json().history;
    assert.equal(entriesAfterRollback.length, 2);
    const original = entriesAfterRollback.find((e: { id: string }) => e.id === deployEntry.id);
    assert.equal(original.rolledBack, true);
    const rollbackEntry = entriesAfterRollback.find(
      (e: { rollbackOf: string | null }) => e.rollbackOf === deployEntry.id,
    );
    assert.ok(rollbackEntry);
    assert.equal(rollbackEntry.rollbackSql, null, "rolling back a rollback is not offered");

    // Rolling back the same deployment a second time is refused.
    const secondAttempt = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/connections/${connId}/history/${deployEntry.id}/rollback`,
      headers: headers({ cookie }),
      payload: {},
    });
    assert.equal(secondAttempt.statusCode, 400);
    assert.equal(secondAttempt.json().code, "ROLLBACK_ALREADY_ATTEMPTED");
  } finally {
    // `getRoom` caches a `Room` (and its Awareness heartbeat timer) at
    // module scope, outside the Fastify instance `app.close()` tears down —
    // without this, the timer keeps the process alive after the test run
    // finishes instead of exiting cleanly.
    closeAllRooms();
    await app.close();
  }
});

test("deployment history and rollback are admin-only, not just view", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const stranger = await makeUser();
    const ownerCookie = await loginAs(app, owner.email, owner.password);
    const strangerCookie = await loginAs(app, stranger.email, stranger.password);

    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: headers({ cookie: ownerCookie }),
      payload: { name: "Admin-only history" },
    });
    const project = created.json();

    const connRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/connections`,
      headers: headers({ cookie: ownerCookie }),
      payload: { name: "Local", engine: "sqlite", database: ":memory:" },
    });
    const connId = connRes.json().connection.id;

    // A stranger defaults to `view` on an ownerless-team project — enough to
    // see it in a list, not enough to reach deployment history.
    const forbidden = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/connections/${connId}/history`,
      headers: headers({ cookie: strangerCookie }),
    });
    assert.equal(forbidden.statusCode, 403);

    const forbiddenRollback = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/connections/${connId}/history/${randomUUID()}/rollback`,
      headers: headers({ cookie: strangerCookie }),
      payload: {},
    });
    assert.equal(forbiddenRollback.statusCode, 403);
  } finally {
    // `getRoom` caches a `Room` (and its Awareness heartbeat timer) at
    // module scope, outside the Fastify instance `app.close()` tears down —
    // without this, the timer keeps the process alive after the test run
    // finishes instead of exiting cleanly.
    closeAllRooms();
    await app.close();
  }
});

test("rollback on an unknown history entry, or one with no rollback SQL, is refused cleanly", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const cookie = await loginAs(app, owner.email, owner.password);

    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: headers({ cookie }),
      payload: { name: "Nothing to roll back" },
    });
    const project = created.json();

    const connRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/connections`,
      headers: headers({ cookie }),
      payload: { name: "Local", engine: "sqlite", database: ":memory:" },
    });
    const connId = connRes.json().connection.id;

    const unknownHistory = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/connections/${connId}/history/${randomUUID()}/rollback`,
      headers: headers({ cookie }),
      payload: {},
    });
    assert.equal(unknownHistory.statusCode, 400);
    assert.equal(unknownHistory.json().code, "DEPLOYMENT_HISTORY_NOT_FOUND");

    // An empty canvas against an empty live DB deploys nothing, and offers no rollback for it.
    const apply = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/connections/${connId}/apply-deployment`,
      headers: headers({ cookie }),
      payload: { resolutions: {} },
    });
    assert.equal(apply.statusCode, 200);
    assert.equal(apply.json().rollbackAvailable, false);

    const history = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/connections/${connId}/history`,
      headers: headers({ cookie }),
    });
    const [entry] = history.json().history;
    assert.equal(entry.rollbackSql, null);

    const noRollback = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/connections/${connId}/history/${entry.id}/rollback`,
      headers: headers({ cookie }),
      payload: {},
    });
    assert.equal(noRollback.statusCode, 400);
    assert.equal(noRollback.json().code, "ROLLBACK_NOT_AVAILABLE");
  } finally {
    // `getRoom` caches a `Room` (and its Awareness heartbeat timer) at
    // module scope, outside the Fastify instance `app.close()` tears down —
    // without this, the timer keeps the process alive after the test run
    // finishes instead of exiting cleanly.
    closeAllRooms();
    await app.close();
  }
});
