import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Same rationale as `app.test.ts`: env vars must land before anything
// transitively imports `db.ts`/`shared/crypto.ts`.
process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-publicapi-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
process.env.ATHANORDB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms, getRoom } = await import("../../realtime/roomRegistry.js");
const { writeProjectToDoc } = await import("@athanordb/shared");

const HOST = "localhost:3001";
const ORIGIN = `http://${HOST}`;

function headers(extra: Record<string, string> = {}) {
  return { host: HOST, origin: ORIGIN, ...extra };
}

function bearer(key: string) {
  return headers({ authorization: `Bearer ${key}` });
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

async function makeAdmin() {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, 1, NULL)").run(
    id,
    email,
    await hashPassword(password),
  );
  return { id, email, password };
}

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

async function createProjectWithKey(
  app: Awaited<ReturnType<typeof buildApp>>,
  cookie: string,
  scopes: string[],
  projectRestricted = false,
) {
  const created = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: headers({ cookie }),
    payload: { name: `Project ${randomUUID()}` },
  });
  const project = created.json();
  seedCanvasTable(project.id, project.name);

  const keyRes = await app.inject({
    method: "POST",
    url: "/api/keys",
    headers: headers({ cookie }),
    payload: { name: "test key", scopes, projectId: projectRestricted ? project.id : undefined },
  });
  const plaintextKey = keyRes.json().plaintextKey;
  return { project, plaintextKey };
}

test("/api/v1 export: dbml/sql/svg all work with a Bearer API key and reflect the real canvas", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const cookie = await loginAs(app, owner.email, owner.password);
    const { project, plaintextKey } = await createProjectWithKey(app, cookie, ["projects:read"]);

    const dbml = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/export/dbml`,
      headers: bearer(plaintextKey),
    });
    assert.equal(dbml.statusCode, 200);
    assert.match(dbml.body, /widgets/);

    const sql = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/export/sql?dialect=postgres`,
      headers: bearer(plaintextKey),
    });
    assert.equal(sql.statusCode, 200);
    assert.match(sql.body, /widgets/i);

    const svg = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/export/svg`,
      headers: bearer(plaintextKey),
    });
    assert.equal(svg.statusCode, 200);
    assert.equal(svg.headers["content-type"], "image/svg+xml");
    assert.match(svg.body, /<svg /);
    assert.match(svg.body, /widgets/);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("/api/v1 import: a projects:write-scoped key can push a schema edit", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const cookie = await loginAs(app, owner.email, owner.password);
    const { project, plaintextKey } = await createProjectWithKey(app, cookie, ["projects:read", "projects:write"]);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/import`,
      headers: bearer(plaintextKey),
      payload: { source: "Table gadgets {\n  id int [pk]\n}" },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().imported, true);

    const dbml = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/export/dbml`,
      headers: bearer(plaintextKey),
    });
    assert.match(dbml.body, /gadgets/);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("/api/v1: a read-only key is refused write access, not silently downgraded", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const cookie = await loginAs(app, owner.email, owner.password);
    const { project, plaintextKey } = await createProjectWithKey(app, cookie, ["projects:read"]);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/import`,
      headers: bearer(plaintextKey),
      payload: { source: "Table gadgets {\n  id int [pk]\n}" },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().code, "API_SCOPE_INSUFFICIENT");
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("/api/v1: a revoked key is rejected as unauthenticated, not as forbidden", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const cookie = await loginAs(app, owner.email, owner.password);
    const { project, plaintextKey } = await createProjectWithKey(app, cookie, ["projects:read"]);

    const keys = await app.inject({ method: "GET", url: "/api/keys", headers: headers({ cookie }) });
    const keyId = keys.json().keys[0].id;
    await app.inject({ method: "DELETE", url: `/api/keys/${keyId}`, headers: headers({ cookie }) });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/export/dbml`,
      headers: bearer(plaintextKey),
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().code, "AUTH_REQUIRED");
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("/api/v1: a project-restricted key is refused against a different project", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const cookie = await loginAs(app, owner.email, owner.password);
    const { plaintextKey } = await createProjectWithKey(app, cookie, ["projects:read"], true);
    const otherProject = await createProjectWithKey(app, cookie, ["projects:read"]);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${otherProject.project.id}/export/dbml`,
      headers: bearer(plaintextKey),
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().code, "API_KEY_PROJECT_RESTRICTED");
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("/api/v1/projects lists exactly what getEffectivePermission grants the key's owning user — same set the session-authed /api/projects returns", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const cookie = await loginAs(app, owner.email, owner.password);
    const { project, plaintextKey } = await createProjectWithKey(app, cookie, ["projects:read"]);

    const v1 = await app.inject({ method: "GET", url: "/api/v1/projects", headers: bearer(plaintextKey) });
    assert.equal(v1.statusCode, 200);
    const v1Ids = v1
      .json()
      .projects.map((p: { id: string }) => p.id)
      .sort();

    const internal = await app.inject({ method: "GET", url: "/api/projects", headers: headers({ cookie }) });
    const internalIds = (internal.json() as { id: string }[]).map((p) => p.id).sort();

    assert.deepEqual(
      v1Ids,
      internalIds,
      "the public listing must mirror the same permission-filtered set the app itself sees",
    );
    assert.ok(v1Ids.includes(project.id));
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("/api/v1 deploy: a deployments:trigger-scoped key runs the same pipeline as the UI's apply-deployment", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const cookie = await loginAs(app, owner.email, owner.password);
    const { project, plaintextKey } = await createProjectWithKey(app, cookie, ["deployments:trigger", "projects:read"]);

    const targetFile = join(tmpdir(), `athanordb-test-v1target-${randomUUID()}.sqlite`);
    const connRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/connections`,
      headers: headers({ cookie }),
      payload: { name: "Local file", engine: "sqlite", filePath: targetFile },
    });
    const connId = connRes.json().connection.id;

    const deploy = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/connections/${connId}/deploy`,
      headers: bearer(plaintextKey),
      payload: { resolutions: {} },
    });
    assert.equal(deploy.statusCode, 200);
    assert.equal(deploy.json().success, true);

    const history = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/connections/${connId}/history`,
      headers: bearer(plaintextKey),
    });
    assert.equal(history.statusCode, 200);
    assert.equal(history.json().history.length, 1);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("/api/v1 rollback: a deployments:trigger-scoped key can roll back a past deployment", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const cookie = await loginAs(app, owner.email, owner.password);
    const { project, plaintextKey } = await createProjectWithKey(app, cookie, ["deployments:trigger", "projects:read"]);

    const targetFile = join(tmpdir(), `athanordb-test-v1rollback-${randomUUID()}.sqlite`);
    const connRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/connections`,
      headers: headers({ cookie }),
      payload: { name: "Local file", engine: "sqlite", filePath: targetFile },
    });
    const connId = connRes.json().connection.id;

    await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/connections/${connId}/deploy`,
      headers: bearer(plaintextKey),
      payload: { resolutions: {} },
    });
    const history = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/connections/${connId}/history`,
      headers: bearer(plaintextKey),
    });
    const [entry] = history.json().history;

    assert.equal(
      entry.rollbackSql !== null,
      true,
      "creating a table is fully reversible — a DROP TABLE rollback must be stored",
    );

    const rollback = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/connections/${connId}/history/${entry.id}/rollback`,
      headers: bearer(plaintextKey),
      payload: {},
    });
    assert.equal(rollback.statusCode, 200);
    assert.equal(rollback.json().success, true);

    // Rolling back the same entry twice is refused — same guarantee the
    // internal route gives (`deploymentHistory.ts`'s derived `rolledBack`).
    const again = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/connections/${connId}/history/${entry.id}/rollback`,
      headers: bearer(plaintextKey),
      payload: {},
    });
    assert.equal(again.statusCode, 400);
    assert.equal(again.json().code, "ROLLBACK_ALREADY_ATTEMPTED");
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("/api/v1 export: png is a rasterised image, not the raw SVG text", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const cookie = await loginAs(app, owner.email, owner.password);
    const { project, plaintextKey } = await createProjectWithKey(app, cookie, ["projects:read"]);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/export/png`,
      headers: bearer(plaintextKey),
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "image/png");
    const bytes = res.rawPayload;
    // PNG magic bytes: 89 50 4E 47
    assert.equal(bytes[0], 0x89);
    assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG");
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("/api/v1 project CRUD: create, rename/archive, delete — same lifecycle the session-authed routes offer", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const cookie = await loginAs(app, owner.email, owner.password);
    const keyRes = await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: headers({ cookie }),
      payload: { name: "crud key", scopes: ["projects:read", "projects:write"] },
    });
    const plaintextKey = keyRes.json().plaintextKey;

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: bearer(plaintextKey),
      payload: { name: "Created via API" },
    });
    assert.equal(created.statusCode, 201);
    const projectId = created.json().id;

    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${projectId}`,
      headers: bearer(plaintextKey),
      payload: { name: "Renamed via API", status: "archived" },
    });
    assert.equal(renamed.statusCode, 200);
    assert.equal(renamed.json().name, "Renamed via API");
    assert.equal(renamed.json().status, "archived");

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${projectId}`,
      headers: bearer(plaintextKey),
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal(deleted.json().deleted, true);

    const getAfterDelete = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}`,
      headers: bearer(plaintextKey),
    });
    assert.equal(getAfterDelete.statusCode, 404);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("/api/v1 history: exposes the same schema revision log as the session-authed route", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const cookie = await loginAs(app, owner.email, owner.password);
    const { project, plaintextKey } = await createProjectWithKey(app, cookie, ["projects:read", "projects:write"]);

    await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/import`,
      headers: bearer(plaintextKey),
      payload: { source: "Table extra {\n  id int [pk]\n}" },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/history`,
      headers: bearer(plaintextKey),
    });
    assert.equal(res.statusCode, 200);
    assert.ok(res.json().revisions.length > 0);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("/api/v1 IAM: list, grant and revoke a team's access to a project", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const cookie = await loginAs(app, owner.email, owner.password);
    const { project, plaintextKey } = await createProjectWithKey(app, cookie, ["projects:read", "projects:write"]);

    const teamId = randomUUID();
    db.prepare("INSERT INTO teams (id, name) VALUES (?, ?)").run(teamId, `Team ${teamId}`);

    const empty = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/iam`,
      headers: bearer(plaintextKey),
    });
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(empty.json().teams, []);

    const grant = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${project.id}/iam/${teamId}`,
      headers: bearer(plaintextKey),
      payload: { permission: "edit" },
    });
    assert.equal(grant.statusCode, 200);
    assert.equal(grant.json().permission, "edit");

    const afterGrant = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/iam`,
      headers: bearer(plaintextKey),
    });
    assert.equal(afterGrant.json().teams.length, 1);
    assert.equal(afterGrant.json().teams[0].permission, "edit");

    const revoke = await app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${project.id}/iam/${teamId}`,
      headers: bearer(plaintextKey),
    });
    assert.equal(revoke.statusCode, 200);

    const afterRevoke = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/iam`,
      headers: bearer(plaintextKey),
    });
    assert.deepEqual(afterRevoke.json().teams, []);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("/api/v1 connections: CRUD, test, and pull all work with a connections:manage key", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const cookie = await loginAs(app, owner.email, owner.password);
    const { project, plaintextKey } = await createProjectWithKey(app, cookie, [
      "connections:manage",
      "deployments:trigger",
      "projects:read",
      "projects:write",
    ]);

    const targetFile = join(tmpdir(), `athanordb-test-v1conn-${randomUUID()}.sqlite`);
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/connections`,
      headers: bearer(plaintextKey),
      payload: { name: "Local file", engine: "sqlite", filePath: targetFile },
    });
    assert.equal(created.statusCode, 200);
    const connId = created.json().connection.id;

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/connections`,
      headers: bearer(plaintextKey),
    });
    assert.equal(list.json().connections.length, 1);

    const updated = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${project.id}/connections/${connId}`,
      headers: bearer(plaintextKey),
      payload: { name: "Renamed connection" },
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.json().connection.name, "Renamed connection");

    const tested = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/connections/test`,
      headers: bearer(plaintextKey),
      payload: { engine: "sqlite", filePath: targetFile },
    });
    assert.equal(tested.statusCode, 200);
    assert.equal(tested.json().ok, true);

    // Deploy the seeded `widgets` table onto the empty target so pull has something real to bring back.
    const deployRes = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/connections/${connId}/deploy`,
      headers: bearer(plaintextKey),
      payload: { resolutions: {} },
    });
    assert.equal(deployRes.statusCode, 200);

    // Wipe the canvas, then confirm `pull` brings `widgets` back from the target DB.
    const importRes = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/import`,
      headers: bearer(plaintextKey),
      payload: { source: "// empty" },
    });
    assert.equal(importRes.statusCode, 200);
    const pulled = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/connections/${connId}/pull`,
      headers: bearer(plaintextKey),
    });
    assert.equal(pulled.statusCode, 200);
    assert.equal(pulled.json().tablesCount, 1);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${project.id}/connections/${connId}`,
      headers: bearer(plaintextKey),
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal(deleted.json().deleted, true);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("/api/v1 connections: a projects:write-only key is refused — connections need their own scope", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const cookie = await loginAs(app, owner.email, owner.password);
    const { project, plaintextKey } = await createProjectWithKey(app, cookie, ["projects:write"]);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/connections`,
      headers: bearer(plaintextKey),
      payload: { name: "x", engine: "sqlite", filePath: "/tmp/x.sqlite" },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().code, "API_SCOPE_INSUFFICIENT");
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("/api/v1 teams: CRUD and membership all work with a teams:manage key owned by a global admin", async () => {
  const app = await buildApp();
  try {
    const admin = await makeAdmin();
    const cookie = await loginAs(app, admin.email, admin.password);
    const keyRes = await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: headers({ cookie }),
      payload: { name: "team key", scopes: ["teams:manage"] },
    });
    const plaintextKey = keyRes.json().plaintextKey;

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/teams",
      headers: bearer(plaintextKey),
      payload: { name: "Platform team" },
    });
    assert.equal(created.statusCode, 201);
    const teamId = created.json().id;

    const list = await app.inject({ method: "GET", url: "/api/v1/teams", headers: bearer(plaintextKey) });
    assert.ok(list.json().teams.some((t: { id: string }) => t.id === teamId));

    const member = await makeUser();
    const addMember = await app.inject({
      method: "POST",
      url: `/api/v1/teams/${teamId}/members`,
      headers: bearer(plaintextKey),
      payload: { userId: member.id },
    });
    assert.equal(addMember.statusCode, 200);
    assert.equal(addMember.json().added, true);

    const detail = await app.inject({ method: "GET", url: `/api/v1/teams/${teamId}`, headers: bearer(plaintextKey) });
    assert.equal(detail.json().members.length, 1);
    assert.equal(detail.json().members[0].id, member.id);

    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/v1/teams/${teamId}`,
      headers: bearer(plaintextKey),
      payload: { name: "Renamed team" },
    });
    assert.equal(renamed.json().name, "Renamed team");

    const removeMember = await app.inject({
      method: "DELETE",
      url: `/api/v1/teams/${teamId}/members/${member.id}`,
      headers: bearer(plaintextKey),
    });
    assert.equal(removeMember.statusCode, 200);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/teams/${teamId}`,
      headers: bearer(plaintextKey),
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal(deleted.json().deleted, true);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("/api/v1 teams: a non-admin key is refused regardless of scope — team management is instance-wide", async () => {
  const app = await buildApp();
  try {
    const user = await makeUser();
    const cookie = await loginAs(app, user.email, user.password);
    const keyRes = await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: headers({ cookie }),
      payload: { name: "non-admin team key", scopes: ["teams:manage"] },
    });
    const plaintextKey = keyRes.json().plaintextKey;

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams",
      headers: bearer(plaintextKey),
      payload: { name: "Should not be created" },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().code, "ADMIN_REQUIRED");
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("/api/v1 teams: a project-restricted key is refused outright — team management isn't project-scoped", async () => {
  const app = await buildApp();
  try {
    const admin = await makeAdmin();
    const cookie = await loginAs(app, admin.email, admin.password);
    const { plaintextKey } = await createProjectWithKey(app, cookie, ["teams:manage"], true);

    const res = await app.inject({ method: "GET", url: "/api/v1/teams", headers: bearer(plaintextKey) });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().code, "API_KEY_PROJECT_RESTRICTED");
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("/api/v1 IAM grant: a projects:write scope alone is not enough without project administrator permission", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const cookie = await loginAs(app, owner.email, owner.password);
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: headers({ cookie }),
      payload: { name: "IAM permission test" },
    });
    const project = created.json();

    // A second user gets an `edit` grant on the project via a team — enough
    // to import/write the schema, but not enough to manage IAM itself.
    const editor = await makeUser();
    const teamId = randomUUID();
    db.prepare("INSERT INTO teams (id, name) VALUES (?, ?)").run(teamId, `Team ${teamId}`);
    db.prepare("INSERT INTO team_members (team_id, user_id) VALUES (?, ?)").run(teamId, editor.id);
    db.prepare("INSERT INTO project_teams (project_id, team_id, permission) VALUES (?, ?, ?)").run(
      project.id,
      teamId,
      "edit",
    );

    const editorCookie = await loginAs(app, editor.email, editor.password);
    const keyRes = await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: headers({ cookie: editorCookie }),
      payload: { name: "editor key", scopes: ["projects:write"] },
    });
    const editorKey = keyRes.json().plaintextKey;

    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/projects/${project.id}/iam/${randomUUID()}`,
      headers: bearer(editorKey),
      payload: { permission: "view" },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().code, "FORBIDDEN");
  } finally {
    closeAllRooms();
    await app.close();
  }
});
