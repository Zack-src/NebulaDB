import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `routes/crud.ts` (create/rename/delete/list, permission gating) is covered
// in `../../app.test.ts` already — this file is the remaining three:
// `routes/importExport.ts`, `routes/revisions.ts`, `routes/teams.ts`.
process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-projectroutes-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
process.env.ATHANORDB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");

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

async function makeProject(app: Awaited<ReturnType<typeof buildApp>>, cookie: string, name = "Test project") {
  const res = await app.inject({ method: "POST", url: "/api/projects", headers: headers({ cookie }), payload: { name } });
  return res.json() as { id: string; name: string };
}

const SAMPLE_DBML = `Table users {\n  id int [pk]\n  email varchar\n}\n`;

test("import/export round-trip: DBML in, DBML/SQL out, a view grant can't import", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const viewer = await makeUser();
    const ownerCookie = await loginAs(app, owner.email, owner.password);
    const viewerCookie = await loginAs(app, viewer.email, viewer.password);
    const project = await makeProject(app, ownerCookie);

    const viewerImport = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/import`,
      headers: headers({ cookie: viewerCookie }),
      payload: { source: SAMPLE_DBML },
    });
    assert.equal(viewerImport.statusCode, 403);

    const imported = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/import`,
      headers: headers({ cookie: ownerCookie }),
      payload: { source: SAMPLE_DBML },
    });
    assert.equal(imported.statusCode, 200);
    assert.equal(imported.json().tables, 1);

    const exportedDbml = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/export/dbml`,
      headers: headers({ cookie: viewerCookie }), // export only needs "view"
    });
    assert.equal(exportedDbml.statusCode, 200);
    assert.match(exportedDbml.body, /Table users/);

    const exportedSql = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/export/sql?dialect=postgres`,
      headers: headers({ cookie: ownerCookie }),
    });
    assert.equal(exportedSql.statusCode, 200);
    assert.match(exportedSql.body, /CREATE TABLE/i);

    const badDialect = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/export/sql?dialect=nonsense`,
      headers: headers({ cookie: ownerCookie }),
    });
    assert.equal(badDialect.statusCode, 400);
    assert.equal(badDialect.json().code, "SQL_DIALECT_INVALID");

    const malformedImport = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/import`,
      headers: headers({ cookie: ownerCookie }),
      payload: { source: "Table {{{ not dbml" },
    });
    assert.equal(malformedImport.statusCode, 400);
    assert.equal(malformedImport.json().code, "DBML_PARSE_FAILED");
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("revisions: listed after an edit, labelable, restorable; a view grant can read but not label or restore", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const viewer = await makeUser();
    const ownerCookie = await loginAs(app, owner.email, owner.password);
    const viewerCookie = await loginAs(app, viewer.email, viewer.password);
    const project = await makeProject(app, ownerCookie);

    await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/import`,
      headers: headers({ cookie: ownerCookie }),
      payload: { source: SAMPLE_DBML },
    });

    const list = await app.inject({ method: "GET", url: `/api/projects/${project.id}/revisions`, headers: headers({ cookie: viewerCookie }) });
    assert.equal(list.statusCode, 200);
    const revisions = list.json() as { id: string }[];
    assert.ok(revisions.length >= 1);
    const revisionId = revisions[0].id;

    const viewerLabel = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/revisions/${revisionId}`,
      headers: headers({ cookie: viewerCookie }),
      payload: { label: "v1.0" },
    });
    assert.equal(viewerLabel.statusCode, 403);

    const label = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/revisions/${revisionId}`,
      headers: headers({ cookie: ownerCookie }),
      payload: { label: "v1.0" },
    });
    assert.equal(label.statusCode, 200);

    const bogusRevision = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/revisions/${randomUUID()}`,
      headers: headers({ cookie: ownerCookie }),
      payload: { label: "nope" },
    });
    assert.equal(bogusRevision.statusCode, 404);
    assert.equal(bogusRevision.json().code, "REVISION_NOT_FOUND");

    // A second, different import — otherwise restoring `revisionId` below
    // would restore a state identical to the current one, and an identical
    // write produces no Yjs diff at all (no new revision to detect).
    await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/import`,
      headers: headers({ cookie: ownerCookie }),
      payload: { source: `${SAMPLE_DBML}\nTable orders {\n  id int [pk]\n}\n` },
    });
    const beforeRestore = await app.inject({ method: "GET", url: `/api/projects/${project.id}/revisions`, headers: headers({ cookie: ownerCookie }) });
    const revisionCountBeforeRestore = (beforeRestore.json() as unknown[]).length;

    const viewerRestore = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/revisions/${revisionId}/restore`,
      headers: headers({ cookie: viewerCookie }),
    });
    assert.equal(viewerRestore.statusCode, 403);

    const restored = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/revisions/${revisionId}/restore`,
      headers: headers({ cookie: ownerCookie }),
    });
    assert.equal(restored.statusCode, 200);
    assert.equal(restored.json().restored, true);

    // Restoring creates a new revision rather than rewriting history, and
    // brings the schema back to the labelled (`v1.0`) state — `orders` is
    // gone again.
    const afterRestore = await app.inject({ method: "GET", url: `/api/projects/${project.id}/revisions`, headers: headers({ cookie: ownerCookie }) });
    assert.ok((afterRestore.json() as unknown[]).length > revisionCountBeforeRestore);

    const snapshot = await app.inject({ method: "GET", url: `/api/projects/${project.id}/snapshot`, headers: headers({ cookie: ownerCookie }) });
    assert.deepEqual(
      (snapshot.json() as { tables: { name: string }[] }).tables.map((t) => t.name).sort(),
      ["users"],
    );
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("project-team routes: granting/revoking is project-admin-only, and an edit grant sees it in GET /api/projects/:id/teams", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const editor = await makeUser();
    const ownerCookie = await loginAs(app, owner.email, owner.password);
    const editorCookie = await loginAs(app, editor.email, editor.password);
    const project = await makeProject(app, ownerCookie);

    const teamRes = await app.inject({
      method: "POST",
      url: "/api/teams",
      headers: headers({ cookie: ownerCookie }), // owner isn't a global admin, so this should fail
      payload: { name: "Should fail" },
    });
    assert.equal(teamRes.statusCode, 403);

    // Bootstrap a team as a real global admin instead.
    const globalAdmin = await makeUser(1);
    const globalAdminCookie = await loginAs(app, globalAdmin.email, globalAdmin.password);
    const created = await app.inject({
      method: "POST",
      url: "/api/teams",
      headers: headers({ cookie: globalAdminCookie }),
      payload: { name: "Reviewers" },
    });
    const team = created.json();

    const grantByNonAdmin = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/teams/${team.id}`,
      headers: headers({ cookie: editorCookie }),
      payload: { permission: "edit" },
    });
    assert.equal(grantByNonAdmin.statusCode, 403);

    const bogusPermission = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/teams/${team.id}`,
      headers: headers({ cookie: ownerCookie }),
      payload: { permission: "owner" },
    });
    assert.equal(bogusPermission.statusCode, 400);
    assert.equal(bogusPermission.json().code, "PERMISSION_INVALID");

    const bogusTeam = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/teams/${randomUUID()}`,
      headers: headers({ cookie: ownerCookie }),
      payload: { permission: "edit" },
    });
    assert.equal(bogusTeam.statusCode, 404);
    assert.equal(bogusTeam.json().code, "TEAM_NOT_FOUND");

    const granted = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/teams/${team.id}`,
      headers: headers({ cookie: ownerCookie }),
      payload: { permission: "edit" },
    });
    assert.equal(granted.statusCode, 200);

    const listed = await app.inject({ method: "GET", url: `/api/projects/${project.id}/teams`, headers: headers({ cookie: ownerCookie }) });
    assert.equal(listed.statusCode, 200);
    assert.ok((listed.json() as { teamId: string }[]).some((t) => t.teamId === team.id));

    const revoked = await app.inject({
      method: "DELETE",
      url: `/api/projects/${project.id}/teams/${team.id}`,
      headers: headers({ cookie: ownerCookie }),
    });
    assert.equal(revoked.statusCode, 200);
  } finally {
    closeAllRooms();
    await app.close();
  }
});
