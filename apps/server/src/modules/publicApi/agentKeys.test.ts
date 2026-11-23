import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

// Same rationale as `app.test.ts`: env vars must land before anything
// transitively imports `db.ts`/`shared/crypto.ts`.
await useTestDatabase("agentkeys");
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");
const { resetConnectionBudgets } = await import("../connections/connectionBudget.js");

/**
 * An AI agent's key (`kind: "agent"`, used by the MCP server) works inside projects only, and
 * never beyond its owner: no project creation or deletion, no project or instance administration,
 * even for an owner who could; SQL as a console member, within the owner's grants.
 */

type App = Awaited<ReturnType<typeof buildApp>>;
type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

const HOST = "localhost:3001";
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `http://${HOST}`, ...extra });
const PASSWORD = "correct horse battery staple";
const ALL_AGENT_SCOPES = ["projects:read", "projects:write", "deployments:trigger", "sql:execute"];
const DBML = "Table widgets {\n  id integer [pk]\n  name varchar\n}\n";

async function makeUser(app: App, isAdmin: 0 | 1 = 0) {
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  await db
    .prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?, NULL)")
    .run(id, email, await hashPassword(PASSWORD), isAdmin);
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password: PASSWORD },
  });
  return { id, email, cookie: `nebuladb_sid=${res.cookies.find((c) => c.name === "nebuladb_sid")!.value}` };
}

function call(app: App, auth: string, method: Method, url: string, payload?: unknown) {
  const credentials: Record<string, string> = auth.startsWith("ndb_")
    ? { authorization: `Bearer ${auth}` }
    : { cookie: auth };
  return app.inject({
    method,
    url,
    headers: headers(credentials),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

async function makeKey(app: App, cookie: string, scopes: string[], kind = "agent", projectId?: string) {
  const res = await call(app, cookie, "POST", "/api/keys", { name: "agent", scopes, kind, projectId });
  assert.equal(res.statusCode, 201, res.body);
  return res.json().plaintextKey as string;
}

async function makeProject(app: App, cookie: string) {
  const res = await call(app, cookie, "POST", "/api/projects", { name: `Project ${randomUUID().slice(0, 6)}` });
  assert.ok(res.statusCode < 300, res.body);
  return res.json() as { id: string; name: string };
}

function seedTarget(): string {
  const file = join(tmpdir(), `nebuladb-test-agent-target-${randomUUID()}.sqlite`);
  const target = new Database(file);
  target.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO customers (name) VALUES ('Ada'), ('Linus');
  `);
  target.close();
  return file;
}

function countRows(file: string, sql: string): number {
  const target = new Database(file, { readonly: true });
  try {
    return (target.prepare(sql).get() as { n: number }).n;
  } finally {
    target.close();
  }
}

/** An instance connection to a SQLite file, linked to the project. */
async function linkedSqlite(app: App, adminCookie: string, projectId: string) {
  const created = await call(app, adminCookie, "POST", "/api/admin/connections", {
    name: `Target ${randomUUID().slice(0, 6)}`,
    engine: "sqlite",
    filePath: seedTarget(),
  });
  assert.equal(created.statusCode, 200, created.body);
  const connection = created.json().connection as { id: string; filePath: string };
  const linked = await call(app, adminCookie, "PUT", `/api/admin/connections/${connection.id}/projects`, {
    projectIds: [projectId],
  });
  assert.equal(linked.statusCode, 200, linked.body);
  return connection;
}

test("an agent key carries only the agent scopes, always with projects:read; sql:execute is the agent's alone", async () => {
  const app = await buildApp();
  try {
    const user = await makeUser(app);
    const create = (scopes: string[], kind?: string) =>
      call(app, user.cookie, "POST", "/api/keys", { name: "k", scopes, ...(kind ? { kind } : {}) });

    for (const scopes of [
      ["projects:read", "connections:manage"],
      ["projects:read", "teams:manage"],
    ]) {
      assert.equal((await create(scopes, "agent")).statusCode, 400, scopes.join());
    }
    assert.equal((await create(["projects:write"], "agent")).statusCode, 400, "projects:read is mandatory");
    assert.equal((await create(["projects:read", "sql:execute"])).statusCode, 400, "not on a standard key");
    assert.equal((await create(["projects:read"], "robot")).statusCode, 400);

    const ok = await create(ALL_AGENT_SCOPES, "agent");
    assert.equal(ok.statusCode, 201, ok.body);
    assert.equal(ok.json().summary.kind, "agent");
    const listed = await call(app, user.cookie, "GET", "/api/keys");
    assert.equal(listed.json().keys[0].kind, "agent");
  } finally {
    await closeAllRooms();
    await app.close();
  }
});

test("an agent key edits its owner's project but never creates, renames, deletes or administers one", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser(app);
    const project = await makeProject(app, owner.cookie);
    const key = await makeKey(app, owner.cookie, ALL_AGENT_SCOPES);
    const base = `/api/v1/projects/${project.id}`;

    const me = await call(app, key, "GET", "/api/v1/me");
    assert.equal(me.statusCode, 200, me.body);
    assert.equal(me.json().key.kind, "agent");
    assert.equal(me.json().ceiling, "deploy");

    // The owner is the project's administrator; their agent sees `deploy`.
    const read = await call(app, key, "GET", base);
    assert.equal(read.statusCode, 200, read.body);
    assert.equal(read.json().permission, "deploy");
    const listed = await call(app, key, "GET", "/api/v1/projects");
    assert.equal(listed.json().projects.find((p: { id: string }) => p.id === project.id).permission, "deploy");

    // Editing the schema is what it is for.
    const imported = await call(app, key, "POST", `${base}/import`, { source: DBML });
    assert.equal(imported.statusCode, 200, imported.body);
    assert.match((await call(app, key, "GET", `${base}/export/dbml`)).body, /Table widgets/);

    // Never: create, rename/archive, delete, access, webhooks, locks, connections, the watch's settings.
    const forbidden: [Method, string, unknown][] = [
      ["POST", "/api/v1/projects", { name: "new" }],
      ["PATCH", base, { name: "renamed" }],
      ["PATCH", base, { status: "trashed" }],
      ["DELETE", base, undefined],
      ["PUT", `${base}/iam/${randomUUID()}`, { permission: "view" }],
      ["GET", `${base}/webhooks`, undefined],
      ["POST", `${base}/webhooks`, { url: "https://example.com/hook" }],
      ["PUT", `${base}/locks/widgets`, { level: "full" }],
      ["DELETE", `${base}/locks/widgets`, undefined],
      ["PUT", `${base}/monitoring`, { enabled: true, intervalMinutes: 60 }],
    ];
    for (const [method, url, payload] of forbidden) {
      const res = await call(app, key, method, url, payload);
      assert.equal(res.statusCode, 403, `${method} ${url}: ${res.body}`);
      assert.equal(res.json().code, "AGENT_KEY_FORBIDDEN", `${method} ${url}`);
    }
    // Connections are administration: the scope itself cannot be on an agent key.
    const connection = await call(app, key, "POST", `${base}/connections`, { name: "x", engine: "sqlite" });
    assert.equal(connection.statusCode, 403);

    // The project is still there, under its name.
    const after = await call(app, owner.cookie, "GET", `/api/projects/${project.id}`);
    assert.equal(after.statusCode, 200);
    assert.equal(after.json().name, project.name);

    // What the agent did is in the audit log, marked as such.
    const audit = (await db
      .prepare("SELECT detail FROM audit_log WHERE actor_id = ? AND action = 'project.import'")
      .all(owner.id)) as { detail: string }[];
    assert.ok(audit.length > 0 && audit.every((row) => row.detail.startsWith("[AI agent]")), JSON.stringify(audit));
  } finally {
    await closeAllRooms();
    await app.close();
  }
});

test("an instance administrator's agent sees the projects, at deploy, and none of the instance's administration", async () => {
  const app = await buildApp();
  try {
    const admin = await makeUser(app, 1);
    const someone = await makeUser(app);
    const project = await makeProject(app, someone.cookie);
    // Restricted (one person granted): the administrator sees it only by being one.
    const reader = await makeUser(app);
    const granted = await call(app, someone.cookie, "PUT", `/api/projects/${project.id}/members/${reader.id}`, {
      permission: "view",
    });
    assert.ok(granted.statusCode < 300, granted.body);

    const key = await makeKey(app, admin.cookie, ALL_AGENT_SCOPES);
    const read = await call(app, key, "GET", `/api/v1/projects/${project.id}`);
    assert.equal(read.statusCode, 200, read.body);
    assert.equal(read.json().permission, "deploy");

    // Teams and backups are the instance's: refused, whatever the owner is.
    for (const url of ["/api/v1/teams", `/api/v1/connections/${randomUUID()}/backups`]) {
      const res = await call(app, key, "GET", url);
      assert.equal(res.statusCode, 403, `${url}: ${res.body}`);
    }
    // A key with the same owner but of the ordinary kind keeps the administrator's rights.
    const standard = await makeKey(app, admin.cookie, ["projects:read", "projects:write"], "standard");
    assert.equal(
      (await call(app, standard, "GET", `/api/v1/projects/${project.id}`)).json().permission,
      "administrator",
    );
  } finally {
    await closeAllRooms();
    await app.close();
  }
});

test("an agent runs SQL on its project's database as a console member, within its owner's grants", async () => {
  const app = await buildApp();
  try {
    resetConnectionBudgets();
    const admin = await makeUser(app, 1);
    const member = await makeUser(app);
    const project = await makeProject(app, member.cookie);
    const connection = await linkedSqlite(app, admin.cookie, project.id);
    const url = `/api/v1/projects/${project.id}/connections/${connection.id}/query`;
    const memberKey = await makeKey(app, member.cookie, ALL_AGENT_SCOPES);

    // No SQL access granted to the member: refused.
    const ungranted = await call(app, memberKey, "POST", url, { sql: "SELECT * FROM customers" });
    assert.equal(ungranted.statusCode, 403, ungranted.body);
    assert.equal(ungranted.json().code, "SQL_ACCESS_NOT_GRANTED");

    // Read access: reads, never writes.
    const grant = (level: string) =>
      call(app, admin.cookie, "PUT", `/api/admin/users/${member.id}/db-access`, {
        grants: [{ connectionId: connection.id, level }],
      });
    assert.equal((await grant("read")).statusCode, 200);
    const read = await call(app, memberKey, "POST", url, { sql: "SELECT name FROM customers ORDER BY id" });
    assert.equal(read.statusCode, 200, read.body);
    assert.equal(read.json().access, "read");
    assert.deepEqual(read.json().result.rows, [["Ada"], ["Linus"]]);
    const writeOnRead = await call(app, memberKey, "POST", url, {
      sql: "DELETE FROM customers",
      readOnly: false,
      confirmWrite: true,
    });
    assert.equal(writeOnRead.json().code, "DB_ACCESS_WRITE_FORBIDDEN");
    // A write disguised as a read is refused by the read-only guard.
    assert.notEqual((await call(app, memberKey, "POST", url, { sql: "DELETE FROM customers" })).statusCode, 200);
    assert.equal(countRows(connection.filePath, "SELECT COUNT(*) AS n FROM customers"), 2);

    // Write access: a confirmed data statement, never structure.
    assert.equal((await grant("write")).statusCode, 200);
    const unconfirmed = await call(app, memberKey, "POST", url, { sql: "DELETE FROM customers", readOnly: false });
    assert.equal(unconfirmed.json().code, "DB_ACCESS_WRITE_CONFIRMATION_REQUIRED");
    const written = await call(app, memberKey, "POST", url, {
      sql: "DELETE FROM customers WHERE name = 'Linus'",
      readOnly: false,
      confirmWrite: true,
    });
    assert.equal(written.statusCode, 200, written.body);
    assert.equal(countRows(connection.filePath, "SELECT COUNT(*) AS n FROM customers"), 1);
    const ddl = await call(app, memberKey, "POST", url, {
      sql: "DROP TABLE customers",
      readOnly: false,
      confirmWrite: true,
    });
    assert.notEqual(ddl.statusCode, 200);
    assert.equal(countRows(connection.filePath, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'"), 1);

    // An administrator's agent without a grant: a member's `write`, not the administrator's console.
    const adminKey = await makeKey(app, admin.cookie, ALL_AGENT_SCOPES);
    const adminRead = await call(app, adminKey, "POST", url, { sql: "SELECT COUNT(*) AS n FROM customers" });
    assert.equal(adminRead.statusCode, 200, adminRead.body);
    assert.equal(adminRead.json().access, "write");
    const adminDdl = await call(app, adminKey, "POST", url, {
      sql: "DROP TABLE customers",
      readOnly: false,
      confirmWrite: true,
    });
    assert.notEqual(adminDdl.statusCode, 200);
    assert.equal(countRows(connection.filePath, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'"), 1);

    // Without the scope, or on a connection the project does not have: refused.
    const noSql = await makeKey(app, member.cookie, ["projects:read"]);
    assert.equal((await call(app, noSql, "POST", url, { sql: "SELECT 1" })).json().code, "API_SCOPE_INSUFFICIENT");
    const other = await makeProject(app, member.cookie);
    const elsewhere = await call(
      app,
      memberKey,
      "POST",
      `/api/v1/projects/${other.id}/connections/${connection.id}/query`,
      {
        sql: "SELECT 1",
      },
    );
    assert.equal(elsewhere.statusCode, 404, elsewhere.body);

    // Kept in the audit trail as the agent's.
    const audit = (await db
      .prepare("SELECT detail FROM audit_log WHERE actor_id = ? AND action = 'dbaccess.query'")
      .all(member.id)) as { detail: string }[];
    assert.ok(audit.length > 0 && audit.every((row) => row.detail.startsWith("[AI agent]")));
  } finally {
    await closeAllRooms();
    await app.close();
  }
});
