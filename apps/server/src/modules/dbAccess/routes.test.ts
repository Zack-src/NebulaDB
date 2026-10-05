import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

// Same rationale as `app.test.ts`: env vars must land before anything
// transitively imports `db.ts`/`shared/crypto.ts`.
process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-dbaccess-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
process.env.ATHANORDB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { createApiKey } = await import("../apiKeys/repository.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");
const { resetConnectionBudgets } = await import("../connections/connectionBudget.js");

type App = Awaited<ReturnType<typeof buildApp>>;
type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

const HOST = "localhost:3001";
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `http://${HOST}`, ...extra });
const PASSWORD = "correct horse battery staple";

async function signIn(app: App, email: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password: PASSWORD },
  });
  return `athanordb_sid=${res.cookies.find((c) => c.name === "athanordb_sid")!.value}`;
}

async function makeUser(app: App, isAdmin: 0 | 1 = 0) {
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?, NULL)").run(
    id,
    email,
    await hashPassword(PASSWORD),
    isAdmin,
  );
  return { id, email, cookie: await signIn(app, email) };
}

function call(app: App, auth: string, method: Method, url: string, payload?: unknown) {
  const credentials: Record<string, string> = auth.startsWith("adb_")
    ? { authorization: `Bearer ${auth}` }
    : { cookie: auth };
  return app.inject({
    method,
    url,
    headers: headers(credentials),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

/** A real SQLite file — the one engine the console can be tested against without a server. */
function seedTarget(): string {
  const file = join(tmpdir(), `athanordb-test-dbaccess-target-${randomUUID()}.sqlite`);
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

async function sqliteConnection(app: App, adminCookie: string) {
  const res = await call(app, adminCookie, "POST", "/api/admin/connections", {
    name: `Target ${randomUUID().slice(0, 6)}`,
    engine: "sqlite",
    filePath: seedTarget(),
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json().connection as { id: string; name: string; filePath: string };
}

const grantUser = (app: App, adminCookie: string, userId: string, grants: unknown[]) =>
  call(app, adminCookie, "PUT", `/api/admin/users/${userId}/db-access`, { grants });

const query = (app: App, cookie: string, connectionId: string, body: Record<string, unknown>) =>
  call(app, cookie, "POST", `/api/connections/${connectionId}/query`, body);

test("private databases are usable only by their owner, absent from admin lists, and audited", async () => {
  const app = await buildApp();
  try {
    resetConnectionBudgets();
    const admin = await makeUser(app, 1);
    const owner = await makeUser(app);
    const stranger = await makeUser(app);
    const created = await call(app, owner.cookie, "POST", "/api/me/connections", {
      name: "Private sandbox",
      engine: "sqlite",
      filePath: seedTarget(),
    });
    assert.equal(created.statusCode, 201, created.body);
    const { id } = created.json().connection;
    assert.equal((await call(app, owner.cookie, "GET", `/api/connections/${id}/overview`)).statusCode, 200);
    assert.equal((await query(app, owner.cookie, id, { sql: "SELECT * FROM customers" })).statusCode, 200);
    for (const other of [admin, stranger]) {
      assert.equal((await query(app, other.cookie, id, { sql: "SELECT * FROM customers" })).statusCode, 404);
      assert.equal(
        (await call(app, other.cookie, "PUT", `/api/me/connections/${id}`, { name: "Stolen", engine: "sqlite" }))
          .statusCode,
        404,
      );
      assert.equal((await call(app, other.cookie, "DELETE", `/api/me/connections/${id}`)).statusCode, 404);
    }
    assert.equal(
      (await call(app, admin.cookie, "GET", "/api/admin/connections"))
        .json()
        .connections.some((c: { id: string }) => c.id === id),
      false,
    );
    assert.equal((await call(app, admin.cookie, "GET", `/api/admin/connections/${id}/overview`)).statusCode, 404);
    assert.equal((await call(app, admin.cookie, "POST", `/api/admin/connections/${id}/health`)).statusCode, 404);
    assert.equal(
      (await call(app, admin.cookie, "POST", `/api/admin/connections/${id}/activity/sample`)).statusCode,
      404,
    );
    assert.equal(
      (
        await call(app, admin.cookie, "POST", "/api/admin/connections/test", {
          id,
          engine: "sqlite",
          filePath: created.json().connection.filePath,
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (await grantUser(app, admin.cookie, stranger.id, [{ connectionId: id, level: "write" }])).statusCode,
      404,
    );
    assert.ok(
      db
        .prepare("SELECT 1 FROM audit_log WHERE action = 'dbconn.create' AND target_id = ? AND actor_id = ?")
        .get(id, owner.id),
    );
    const updated = await call(app, owner.cookie, "PUT", `/api/me/connections/${id}`, {
      name: "Private renamed",
      engine: "sqlite",
      filePath: created.json().connection.filePath,
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(
      (await call(app, owner.cookie, "GET", "/api/me/connections")).json().personal[0].name,
      "Private renamed",
    );
    assert.equal((await call(app, owner.cookie, "DELETE", `/api/me/connections/${id}`)).statusCode, 200);
    assert.equal((await query(app, owner.cookie, id, { sql: "SELECT 1" })).statusCode, 404);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("team account generation skips configured users, persists new secrets, and reports partial failures", async () => {
  const { accountProvisioner } = await import("./provision.js");
  const { savePersonalCredentials } = await import("../connections/personalCredentials.js");
  const { credentialCheck } = await import("../connections/credentialService.js");
  const original = accountProvisioner.create;
  const verify = credentialCheck.verify;
  const app = await buildApp();
  try {
    const admin = await makeUser(app, 1),
      member = await makeUser(app),
      existing = await makeUser(app),
      failed = await makeUser(app);
    const connection = (
      await call(app, admin.cookie, "POST", "/api/admin/connections", {
        name: "Team database",
        engine: "postgres",
        host: "localhost",
        database: "test",
        authMode: "personal",
      })
    ).json().connection;
    const teamId = randomUUID();
    db.prepare("INSERT INTO teams (id, name) VALUES (?, 'Database team')").run(teamId);
    for (const user of [member, existing, failed])
      db.prepare("INSERT INTO team_members (team_id, user_id) VALUES (?, ?)").run(teamId, user.id);
    await call(app, admin.cookie, "PUT", `/api/admin/teams/${teamId}/db-access`, {
      grants: [{ connectionId: connection.id, level: "read" }],
    });
    savePersonalCredentials(connection.id, existing.id, "already_set", "never-overwrite");
    const attempts: string[] = [];
    accountProvisioner.create = async (_id, name, password) => {
      attempts.push(name);
      assert.ok(password.length > 20);
      if (name.includes(failed.id.replace(/-/g, "").slice(0, 24))) throw new Error("refused");
    };
    assert.equal((await call(app, member.cookie, "POST", `/api/admin/teams/${teamId}/db-accounts`)).statusCode, 403);
    const provisioned = await call(app, admin.cookie, "POST", `/api/admin/teams/${teamId}/db-accounts`);
    assert.equal(provisioned.statusCode, 200, provisioned.body);
    const results = provisioned.json().results as { userId: string; status: string }[];
    assert.equal(results.find((r) => r.userId === member.id)?.status, "created");
    assert.equal(results.find((r) => r.userId === existing.id)?.status, "existing");
    assert.equal(results.find((r) => r.userId === failed.id)?.status, "failed");
    assert.equal(attempts.length, 2);
    assert.equal(
      (
        db
          .prepare("SELECT username FROM db_connection_credentials WHERE user_id = ? AND connection_id = ?")
          .get(existing.id, connection.id) as { username: string }
      ).username,
      "already_set",
    );
    credentialCheck.verify = async () => {};
    const assigned = await call(
      app,
      admin.cookie,
      "PUT",
      `/api/admin/users/${failed.id}/connections/${connection.id}/credentials`,
      { username: "assigned", password: "assigned-secret" },
    );
    assert.equal(assigned.statusCode, 200, assigned.body);
    assert.equal(assigned.json().username, "assigned");
    assert.equal(assigned.body.includes("assigned-secret"), false);
    const again = await call(app, admin.cookie, "POST", `/api/admin/teams/${teamId}/db-accounts`);
    assert.ok(again.json().results.every((r: { status: string }) => r.status === "existing"));
  } finally {
    accountProvisioner.create = original;
    credentialCheck.verify = verify;
    closeAllRooms();
    await app.close();
  }
});

test("editor SQL enforces read-only even if the caller sends write mode", async () => {
  const app = await buildApp();
  try {
    resetConnectionBudgets();
    const admin = await makeUser(app, 1);
    const connection = await sqliteConnection(app, admin.cookie);
    const refused = await query(app, admin.cookie, connection.id, {
      sql: "DELETE FROM customers",
      editor: true,
      readOnly: false,
    });
    assert.notEqual(refused.statusCode, 200);
    assert.equal(countRows(connection.filePath, "SELECT COUNT(*) AS n FROM customers"), 2);
    assert.equal(
      (await query(app, admin.cookie, connection.id, { sql: "SELECT * FROM customers", editor: true })).statusCode,
      200,
    );
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("a member reaches a database only once an instance administrator grants it, and loses it at once", async () => {
  const app = await buildApp();
  try {
    resetConnectionBudgets();
    const admin = await makeUser(app, 1);
    const member = await makeUser(app);
    const connection = await sqliteConnection(app, admin.cookie);
    const base = `/api/connections/${connection.id}`;

    // Not granted: the connection does not exist for them — on every console route.
    for (const [method, url] of [
      ["GET", `${base}/overview`],
      ["GET", `${base}/schemas`],
      ["GET", `${base}/tables`],
      ["GET", `${base}/table?table=customers`],
      ["GET", `${base}/rows?table=customers`],
      ["POST", `${base}/query`],
      ["GET", `${base}/query-history`],
    ] as [Method, string][]) {
      const res = await call(app, member.cookie, method, url, method === "POST" ? { sql: "SELECT 1" } : undefined);
      assert.equal(res.statusCode, 404, `${method} ${url}: ${res.body}`);
    }
    assert.deepEqual((await call(app, member.cookie, "GET", "/api/me/db-access")).json(), { connections: [] });
    // Granting is the instance administrator's.
    assert.equal((await grantUser(app, member.cookie, member.id, [])).statusCode, 403);

    const granted = await grantUser(app, admin.cookie, member.id, [{ connectionId: connection.id, level: "read" }]);
    assert.equal(granted.statusCode, 200, granted.body);
    assert.deepEqual(granted.json().grants, [
      { connectionId: connection.id, connectionName: connection.name, level: "read", sqlUsername: null },
    ]);
    assert.deepEqual((await call(app, member.cookie, "GET", "/api/me/db-access")).json(), {
      connections: [{ connectionId: connection.id, level: "read" }],
    });

    const overview = await call(app, member.cookie, "GET", `${base}/overview`);
    assert.equal(overview.statusCode, 200, overview.body);
    assert.equal(overview.json().access, "read");
    // What a member is never offered is not advertised either.
    assert.equal(overview.json().capabilities.users, false);
    assert.equal(overview.json().capabilities.sessions, false);
    assert.deepEqual(overview.json().structurePolicy.projects, []);
    assert.equal((await call(app, member.cookie, "GET", `${base}/tables`)).statusCode, 200);
    const rows = await call(app, member.cookie, "GET", `${base}/rows?table=customers`);
    assert.equal(rows.json().result.rowCount, 2);

    const read = await query(app, member.cookie, connection.id, { sql: "SELECT name FROM customers ORDER BY id" });
    assert.equal(read.statusCode, 200, read.body);
    assert.deepEqual(
      read.json().result.rows.map((row: unknown[]) => row[0]),
      ["Ada", "Linus"],
    );
    // Read access cannot write, however it asks.
    const write = await query(app, member.cookie, connection.id, {
      sql: "INSERT INTO customers (name) VALUES ('Eve')",
      readOnly: false,
      confirmWrite: true,
    });
    assert.equal(write.statusCode, 403);
    assert.equal(write.json().code, "DB_ACCESS_WRITE_FORBIDDEN");
    const sneaky = await query(app, member.cookie, connection.id, {
      sql: "INSERT INTO customers (name) VALUES ('Eve')",
    });
    assert.equal(sneaky.statusCode, 400);
    assert.equal(sneaky.json().code, "DB_ADMIN_WRITE_NOT_ALLOWED");
    assert.equal(countRows(connection.filePath, "SELECT COUNT(*) AS n FROM customers"), 2);

    // Everything is in the audit trail, refused attempts included, marked as a member's.
    const trail = db
      .prepare("SELECT detail FROM audit_log WHERE action = 'dbaccess.query' AND actor_id = ? ORDER BY rowid")
      .all(member.id) as { detail: string }[];
    assert.equal(trail.length, 2);
    assert.match(trail[0].detail, /^\[read access\] read ok 2 row\(s\)/);
    assert.match(trail[1].detail, /^\[read access\] read failed/);
    // The rest of the console stays the instance administrator's.
    for (const [method, url] of [
      ["POST", `/api/admin/connections/${connection.id}/query`],
      ["GET", `/api/admin/connections/${connection.id}/overview`],
      ["POST", `/api/admin/connections/${connection.id}/drop`],
      ["GET", `/api/admin/connections/${connection.id}/principals`],
      ["GET", `/api/admin/connections/${connection.id}/sessions`],
      ["GET", `/api/admin/connections/${connection.id}/backups`],
    ] as [Method, string][]) {
      const res = await call(app, member.cookie, method, url, method === "POST" ? {} : undefined);
      assert.equal(res.statusCode, 403, `${method} ${url}: ${res.body}`);
    }

    // An API key of the same member does not carry the grant.
    const key = createApiKey(member.id, "ci", ["projects:read"], null).plaintextKey;
    assert.equal((await query(app, key, connection.id, { sql: "SELECT 1" })).statusCode, 404);

    // Revoked: the very next request is refused.
    assert.equal((await grantUser(app, admin.cookie, member.id, [])).statusCode, 200);
    assert.equal((await query(app, member.cookie, connection.id, { sql: "SELECT 1" })).statusCode, 404);
    assert.equal((await call(app, member.cookie, "GET", `${base}/overview`)).statusCode, 404);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("write access runs data statements once confirmed, and never structure", async () => {
  const app = await buildApp();
  try {
    resetConnectionBudgets();
    const admin = await makeUser(app, 1);
    const member = await makeUser(app);
    const connection = await sqliteConnection(app, admin.cookie);
    await grantUser(app, admin.cookie, member.id, [{ connectionId: connection.id, level: "write" }]);
    const insert = { sql: "INSERT INTO customers (name) VALUES ('Grace')", readOnly: false };

    const unconfirmed = await query(app, member.cookie, connection.id, insert);
    assert.equal(unconfirmed.statusCode, 409);
    assert.equal(unconfirmed.json().code, "DB_ACCESS_WRITE_CONFIRMATION_REQUIRED");
    assert.equal(countRows(connection.filePath, "SELECT COUNT(*) AS n FROM customers"), 2);

    const confirmed = await query(app, member.cookie, connection.id, { ...insert, confirmWrite: true });
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    assert.equal(countRows(connection.filePath, "SELECT COUNT(*) AS n FROM customers"), 3);
    const update = await query(app, member.cookie, connection.id, {
      sql: "UPDATE customers SET name = 'Grace H.' WHERE name = 'Grace'",
      readOnly: false,
      confirmWrite: true,
    });
    assert.equal(update.statusCode, 200, update.body);

    for (const sql of [
      "CREATE TABLE stolen (id INTEGER)",
      "DROP TABLE customers",
      "ALTER TABLE customers ADD COLUMN x TEXT",
      "DELETE FROM customers; DROP TABLE customers",
      "INSERT INTO customers (name) VALUES ('x'); CREATE TABLE t (id INTEGER)",
      "ATTACH DATABASE '/tmp/x.sqlite' AS x",
      "PRAGMA writable_schema = 1",
      "CREATE INDEX idx_name ON customers(name)",
    ]) {
      const res = await query(app, member.cookie, connection.id, { sql, readOnly: false, confirmWrite: true });
      assert.equal(res.statusCode, 400, `${sql}: ${res.body}`);
      assert.equal(res.json().code, "DB_ACCESS_STATEMENT_NOT_ALLOWED", sql);
    }
    assert.equal(countRows(connection.filePath, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'"), 1);
    assert.equal(countRows(connection.filePath, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index'"), 0);

    // A connection marked read-only stays read-only for everybody.
    await call(app, admin.cookie, "PUT", `/api/admin/connections/${connection.id}`, { readOnly: true });
    const blocked = await query(app, member.cookie, connection.id, { ...insert, confirmWrite: true });
    assert.equal(blocked.json().code, "CONNECTION_READ_ONLY");

    // The administrator's own console is unchanged: no confirmation flag needed, structure under the policy.
    await call(app, admin.cookie, "PUT", `/api/admin/connections/${connection.id}`, { readOnly: false });
    const adminWrite = await query(app, admin.cookie, connection.id, {
      sql: "CREATE TABLE notes (id INTEGER)",
      readOnly: false,
    });
    assert.equal(adminWrite.statusCode, 200, adminWrite.body);
    assert.equal(
      (await call(app, admin.cookie, "GET", `/api/connections/${connection.id}/overview`)).json().access,
      "admin",
    );
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("a team's grant reaches its members, and stops with the membership or the team", async () => {
  const app = await buildApp();
  try {
    resetConnectionBudgets();
    const admin = await makeUser(app, 1);
    const member = await makeUser(app);
    const connection = await sqliteConnection(app, admin.cookie);
    const team = (await call(app, admin.cookie, "POST", "/api/teams", { name: `Analysts ${randomUUID()}` })).json() as {
      id: string;
      name: string;
    };
    await call(app, admin.cookie, "POST", `/api/teams/${team.id}/members`, { userId: member.id });

    // A team has no database account to carry.
    const withAccount = await call(app, admin.cookie, "PUT", `/api/admin/teams/${team.id}/db-access`, {
      grants: [{ connectionId: connection.id, level: "read", sqlUsername: "x" }],
    });
    assert.equal(withAccount.statusCode, 400);
    const granted = await call(app, admin.cookie, "PUT", `/api/admin/teams/${team.id}/db-access`, {
      grants: [{ connectionId: connection.id, level: "read" }],
    });
    assert.equal(granted.statusCode, 200, granted.body);

    assert.equal((await query(app, member.cookie, connection.id, { sql: "SELECT 1" })).statusCode, 200);
    const shown = (await call(app, admin.cookie, "GET", `/api/admin/users/${member.id}/db-access`)).json();
    assert.deepEqual(shown.grants, []);
    assert.deepEqual(shown.inherited, [
      {
        connectionId: connection.id,
        connectionName: connection.name,
        level: "read",
        teamId: team.id,
        teamName: team.name,
      },
    ]);
    // The highest level wins: the member's own `write` on top of the team's `read`.
    await grantUser(app, admin.cookie, member.id, [{ connectionId: connection.id, level: "write" }]);
    assert.deepEqual((await call(app, member.cookie, "GET", "/api/me/db-access")).json().connections, [
      { connectionId: connection.id, level: "write" },
    ]);
    await grantUser(app, admin.cookie, member.id, []);

    await call(app, admin.cookie, "DELETE", `/api/teams/${team.id}/members/${member.id}`);
    assert.equal((await query(app, member.cookie, connection.id, { sql: "SELECT 1" })).statusCode, 404);
    await call(app, admin.cookie, "POST", `/api/teams/${team.id}/members`, { userId: member.id });
    assert.equal((await query(app, member.cookie, connection.id, { sql: "SELECT 1" })).statusCode, 200);

    // Deleting the team takes its grants with it (no foreign keys in this database).
    await call(app, admin.cookie, "DELETE", `/api/teams/${team.id}`);
    assert.equal((await query(app, member.cookie, connection.id, { sql: "SELECT 1" })).statusCode, 404);
    const left = db.prepare("SELECT COUNT(*) AS n FROM db_access_grants WHERE subject_id = ?").get(team.id) as {
      n: number;
    };
    assert.equal(left.n, 0);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("grants and account names go with the user and with the connection", async () => {
  const app = await buildApp();
  try {
    resetConnectionBudgets();
    const admin = await makeUser(app, 1);
    const member = await makeUser(app);
    const one = await sqliteConnection(app, admin.cookie);
    const two = await sqliteConnection(app, admin.cookie);
    const res = await grantUser(app, admin.cookie, member.id, [
      { connectionId: one.id, level: "read", sqlUsername: "ada" },
      { connectionId: two.id, level: null, sqlUsername: "ada_ro" },
    ]);
    assert.equal(res.statusCode, 200, res.body);
    // An account name alone grants nothing.
    assert.equal((await query(app, member.cookie, two.id, { sql: "SELECT 1" })).statusCode, 404);
    // Bad input is refused whole.
    for (const grants of [
      [{ connectionId: "nope", level: "read" }],
      [{ connectionId: one.id, level: "admin" }],
      [
        { connectionId: one.id, level: "read" },
        { connectionId: one.id, level: "write" },
      ],
    ]) {
      assert.notEqual((await grantUser(app, admin.cookie, member.id, grants)).statusCode, 200);
    }
    const count = (sql: string, id: string) => (db.prepare(sql).get(id) as { n: number }).n;
    assert.equal(count("SELECT COUNT(*) AS n FROM db_account_hints WHERE user_id = ?", member.id), 2);

    await call(app, admin.cookie, "DELETE", `/api/admin/connections/${one.id}`);
    assert.equal(count("SELECT COUNT(*) AS n FROM db_access_grants WHERE connection_id = ?", one.id), 0);
    assert.equal(count("SELECT COUNT(*) AS n FROM db_account_hints WHERE connection_id = ?", one.id), 0);

    const deleted = await call(app, admin.cookie, "DELETE", `/api/users/${member.id}`, {});
    assert.equal(deleted.statusCode, 200, deleted.body);
    assert.equal(count("SELECT COUNT(*) AS n FROM db_account_hints WHERE user_id = ?", member.id), 0);
    assert.equal(
      count("SELECT COUNT(*) AS n FROM db_access_grants WHERE subject_type = 'user' AND subject_id = ?", member.id),
      0,
    );
  } finally {
    closeAllRooms();
    await app.close();
  }
});

/** A PostgreSQL connection nothing listens behind: every check below happens before connecting. */
const UNREACHABLE = {
  engine: "postgres",
  host: "127.0.0.1",
  port: 1,
  database: "shop",
  user: "athanor_service",
  password: "service-password",
};

test("on personal accounts a member runs as themself, and without an account is refused", async () => {
  const app = await buildApp();
  try {
    resetConnectionBudgets();
    const admin = await makeUser(app, 1);
    const member = await makeUser(app);
    const created = await call(app, admin.cookie, "POST", "/api/admin/connections", {
      name: "Personal",
      ...UNREACHABLE,
      authMode: "personal",
    });
    assert.equal(created.statusCode, 200, created.body);
    const { id } = created.json().connection as { id: string };
    await grantUser(app, admin.cookie, member.id, [{ connectionId: id, level: "read", sqlUsername: "ada" }]);

    const refused = await query(app, member.cookie, id, { sql: "SELECT 1" });
    assert.equal(refused.statusCode, 409, refused.body);
    assert.equal(refused.json().code, "PERSONAL_CREDENTIALS_REQUIRED");
    // A granted member may give their own account, and the name the administrator chose is offered.
    const status = await call(app, member.cookie, "GET", `/api/connections/${id}/credentials`);
    assert.equal(status.statusCode, 200, status.body);
    assert.deepEqual(status.json(), {
      authMode: "personal",
      username: null,
      updatedAt: null,
      suggestedUsername: "ada",
    });
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("the console refuses to drop, lock or re-password the account the connection signs in with", async () => {
  const app = await buildApp();
  try {
    resetConnectionBudgets();
    const admin = await makeUser(app, 1);
    const byFields = (
      await call(app, admin.cookie, "POST", "/api/admin/connections", { name: "Fields", ...UNREACHABLE })
    ).json().connection as { id: string };
    const byString = (
      await call(app, admin.cookie, "POST", "/api/admin/connections", {
        name: "String",
        engine: "postgres",
        connectionString: "postgres://deployer:secret@127.0.0.1:1/shop",
      })
    ).json().connection as { id: string };

    const act = (connectionId: string, action: unknown, execute = false) =>
      call(app, admin.cookie, "POST", `/api/admin/connections/${connectionId}/users`, { action, execute });
    for (const [connectionId, name] of [
      [byFields.id, "athanor_service"],
      [byFields.id, "ATHANOR_SERVICE"],
      [byString.id, "deployer"],
    ]) {
      for (const action of [
        { type: "drop", principal: { name } },
        { type: "password", principal: { name }, password: "new-one" },
        { type: "lock", principal: { name }, locked: true },
      ]) {
        for (const execute of [false, true]) {
          const res = await act(connectionId, action, execute);
          assert.equal(res.statusCode, 409, `${name} ${JSON.stringify(action)}: ${res.body}`);
          assert.equal(res.json().code, "DB_ADMIN_CONNECTION_ACCOUNT_PROTECTED");
        }
      }
    }
    // Unlocking it, or acting on another account, goes on to the database (unreachable here).
    const unlock = await act(byFields.id, { type: "lock", principal: { name: "athanor_service" }, locked: false });
    assert.notEqual(unlock.json().code, "DB_ADMIN_CONNECTION_ACCOUNT_PROTECTED");
    const other = await act(byFields.id, { type: "drop", principal: { name: "someone_else" } });
    assert.notEqual(other.json().code, "DB_ADMIN_CONNECTION_ACCOUNT_PROTECTED");
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("an invitation's teams and database access are in place the moment it is accepted", async () => {
  const app = await buildApp();
  try {
    resetConnectionBudgets();
    const admin = await makeUser(app, 1);
    const connection = await sqliteConnection(app, admin.cookie);
    const team = (await call(app, admin.cookie, "POST", "/api/teams", { name: `Support ${randomUUID()}` })).json() as {
      id: string;
      name: string;
    };
    const email = `${randomUUID()}@example.com`;

    for (const body of [
      { email, teamIds: ["no-such-team"] },
      { email, databases: [{ connectionId: connection.id, level: "owner" }] },
      { email, databases: "everything" },
    ]) {
      assert.notEqual((await call(app, admin.cookie, "POST", "/api/invitations", body)).statusCode, 201);
    }
    const created = await call(app, admin.cookie, "POST", "/api/invitations", {
      email,
      teamIds: [team.id],
      databases: [{ connectionId: connection.id, level: "write", sqlUsername: "grace" }],
    });
    assert.equal(created.statusCode, 201, created.body);
    const { token } = created.json() as { token: string };
    const listed = (
      (await call(app, admin.cookie, "GET", "/api/invitations")).json() as Record<string, unknown>[]
    ).find((row) => row.token === token)!;
    assert.deepEqual(listed.teams, [{ id: team.id, name: team.name }]);
    assert.deepEqual(listed.databases, [
      { connectionId: connection.id, connectionName: connection.name, level: "write", sqlUsername: "grace" },
    ]);

    const accepted = await app.inject({
      method: "POST",
      url: `/api/invitations/${token}/accept`,
      headers: headers(),
      payload: { password: PASSWORD },
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
    const cookie = await signIn(app, email);
    const newId = (db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string }).id;

    assert.ok(db.prepare("SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?").get(team.id, newId));
    assert.deepEqual((await call(app, cookie, "GET", "/api/me/db-access")).json().connections, [
      { connectionId: connection.id, level: "write" },
    ]);
    const write = await query(app, cookie, connection.id, {
      sql: "INSERT INTO customers (name) VALUES ('Grace')",
      readOnly: false,
      confirmWrite: true,
    });
    assert.equal(write.statusCode, 200, write.body);
    const credentials = await call(app, cookie, "GET", `/api/connections/${connection.id}/credentials`);
    assert.equal(credentials.json().suggestedUsername, "grace");
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("an invitation can ask for the database account to be created, and a failure there costs nothing", async () => {
  const app = await buildApp();
  try {
    resetConnectionBudgets();
    const admin = await makeUser(app, 1);
    const file = await sqliteConnection(app, admin.cookie);
    const personal = (
      await call(app, admin.cookie, "POST", "/api/admin/connections", {
        ...UNREACHABLE,
        name: "Shop",
        authMode: "personal",
      })
    ).json().connection as { id: string };
    const email = `${randomUUID()}@example.com`;

    // Only on a personal-account connection, and only with a name to give it.
    for (const databases of [
      [{ connectionId: file.id, level: "read", sqlUsername: "ada", createAccount: true }],
      [{ connectionId: personal.id, level: "read", createAccount: true }],
    ]) {
      assert.equal((await call(app, admin.cookie, "POST", "/api/invitations", { email, databases })).statusCode, 400);
    }
    // Not from the user screen: only an invitation creates accounts.
    const user = await makeUser(app);
    const put = await call(app, admin.cookie, "PUT", `/api/admin/users/${user.id}/db-access`, {
      grants: [{ connectionId: personal.id, level: "read", sqlUsername: "ada", createAccount: true }],
    });
    assert.equal(put.statusCode, 400);

    const created = await call(app, admin.cookie, "POST", "/api/invitations", {
      email,
      databases: [{ connectionId: personal.id, level: "read", sqlUsername: "ada", createAccount: true }],
    });
    assert.equal(created.statusCode, 201, created.body);
    const { token } = created.json() as { token: string };
    // Nothing answers behind this connection: the account cannot be created, the invitation is accepted all the same.
    const accepted = await app.inject({
      method: "POST",
      url: `/api/invitations/${token}/accept`,
      headers: headers(),
      payload: { password: PASSWORD },
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
    const cookie = await signIn(app, email);
    assert.deepEqual((await call(app, cookie, "GET", "/api/me/db-access")).json().connections, [
      { connectionId: personal.id, level: "read" },
    ]);
    const status = (await call(app, cookie, "GET", `/api/connections/${personal.id}/credentials`)).json();
    assert.equal(status.username, null);
    assert.equal(status.suggestedUsername, "ada");
    const trail = db
      .prepare("SELECT detail FROM audit_log WHERE action = 'dbuser.create_failed' AND target_id = ?")
      .all(personal.id) as {
      detail: string;
    }[];
    assert.equal(trail.length, 1);
    assert.equal(trail[0].detail.includes(PASSWORD), false);
  } finally {
    closeAllRooms();
    await app.close();
  }
});
