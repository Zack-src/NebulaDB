import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

// Same rationale as `app.test.ts`: env vars must land before anything
// transitively imports `db.ts`/`shared/crypto.ts`.
process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-dbadmin-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
process.env.ATHANORDB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");
const { resetConnectionBudgets } = await import("../connections/connectionBudget.js");

type App = Awaited<ReturnType<typeof buildApp>>;

const HOST = "localhost:3001";
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `http://${HOST}`, ...extra });

async function makeUser(isAdmin: 0 | 1) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?, NULL)").run(
    randomUUID(),
    email,
    await hashPassword(password),
    isAdmin,
  );
  return { email, password };
}

async function login(app: App, isAdmin: 0 | 1): Promise<string> {
  const user = await makeUser(isAdmin);
  const res = await app.inject({ method: "POST", url: "/api/auth/login", headers: headers(), payload: user });
  return `athanordb_sid=${res.cookies.find((c) => c.name === "athanordb_sid")!.value}`;
}

function call(app: App, cookie: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: headers({ cookie }),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

/** A real SQLite file with two tables and a view — the one engine that needs no server to test the console against. */
function seedTarget(): string {
  const file = join(tmpdir(), `athanordb-test-dbadmin-target-${randomUUID()}.sqlite`);
  const target = new Database(file);
  target.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE);
    CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), total REAL DEFAULT 0, note TEXT);
    CREATE INDEX idx_orders_user ON orders(user_id);
    CREATE VIEW big_orders AS SELECT * FROM orders WHERE total > 100;
    INSERT INTO users (name, email) VALUES ('Ada', 'ada@example.com'), ('Linus', 'linus@example.com'), ('Grace', NULL);
    INSERT INTO orders (user_id, total, note) VALUES (1, 250, 'big'), (2, 10, 'small');
  `);
  target.close();
  return file;
}

async function createConnection(app: App, cookie: string, extra: Record<string, unknown> = {}) {
  const res = await call(app, cookie, "POST", "/api/admin/connections", {
    name: "Target",
    engine: "sqlite",
    filePath: seedTarget(),
    ...extra,
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json().connection as { id: string; filePath: string };
}

test("every admin connection route refuses a non-admin, and an anonymous caller", async () => {
  const app = await buildApp();
  try {
    const cookie = await login(app, 0);
    const routes: ["GET" | "POST" | "PUT" | "DELETE", string][] = [
      ["GET", "/api/admin/connections"],
      ["POST", "/api/admin/connections"],
      ["PUT", "/api/admin/connections/x"],
      ["DELETE", "/api/admin/connections/x"],
      ["PUT", "/api/admin/connections/x/projects"],
      ["POST", "/api/admin/connections/test"],
      ["POST", "/api/admin/connections/x/health"],
      ["GET", "/api/admin/connections/x/overview"],
      ["GET", "/api/admin/connections/x/schemas"],
      ["GET", "/api/admin/connections/x/tables"],
      ["GET", "/api/admin/connections/x/table"],
      ["GET", "/api/admin/connections/x/rows"],
      ["POST", "/api/admin/connections/x/query"],
      ["GET", "/api/admin/connections/x/query-history"],
      ["POST", "/api/admin/connections/x/drop"],
      ["GET", "/api/admin/connections/x/principals"],
      ["GET", "/api/admin/connections/x/grants"],
      ["POST", "/api/admin/connections/x/users"],
      ["GET", "/api/admin/connections/x/sessions"],
      ["POST", "/api/admin/connections/x/sessions/kill"],
    ];
    for (const [method, url] of routes) {
      const res = await call(app, cookie, method, url, method === "GET" || method === "DELETE" ? undefined : {});
      assert.equal(res.statusCode, 403, `${method} ${url}`);
      assert.equal(res.json().code, "ADMIN_REQUIRED");
      const anonymous = await app.inject({
        method,
        url,
        headers: headers(),
        ...(method === "GET" || method === "DELETE" ? {} : { payload: {} }),
      });
      assert.equal(anonymous.statusCode, 401, `${method} ${url} (anonymous)`);
    }
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("global connection lifecycle: create, list without secrets, update keeping the password, link, delete", async () => {
  const app = await buildApp();
  try {
    const cookie = await login(app, 1);
    const created = await call(app, cookie, "POST", "/api/admin/connections", {
      name: "Prod",
      engine: "postgres",
      host: "db.internal",
      port: 5432,
      user: "app",
      password: "s3cret",
      environment: "production",
      tags: ["eu", "eu", " critical "],
      readOnly: true,
    });
    assert.equal(created.statusCode, 200, created.body);
    const connection = created.json().connection;
    assert.equal(connection.origin, "admin");
    assert.deepEqual(connection.tags, ["eu", "critical"]);
    assert.equal(connection.readOnly, true);
    assert.equal(connection.hasPassword, true);
    assert.ok(!created.body.includes("s3cret"), "the password never comes back");
    assert.deepEqual(connection.health, { status: null, checkedAt: null, version: null, latencyMs: null, error: null });

    const stored = db.prepare("SELECT config_encrypted FROM db_connections WHERE id = ?").get(connection.id) as {
      config_encrypted: string;
    };
    assert.ok(!stored.config_encrypted.includes("s3cret"), "encrypted at rest");

    assert.equal(
      (await call(app, cookie, "POST", "/api/admin/connections", { name: "x", engine: "mongo" })).json().code,
      "CONNECTION_ENGINE_INVALID",
    );
    assert.equal(
      (await call(app, cookie, "POST", "/api/admin/connections", { engine: "mysql" })).json().code,
      "NAME_REQUIRED",
    );

    const updated = await call(app, cookie, "PUT", `/api/admin/connections/${connection.id}`, {
      name: "Prod EU",
      password: "",
      readOnly: false,
    });
    assert.equal(updated.json().connection.name, "Prod EU");
    assert.equal(updated.json().connection.hasPassword, true, "an empty password means unchanged");
    assert.equal(updated.json().connection.readOnly, false);

    const project = (await call(app, cookie, "POST", "/api/projects", { name: "Linked project" })).json();
    const linked = await call(app, cookie, "PUT", `/api/admin/connections/${connection.id}/projects`, {
      projectIds: [project.id, "nope"],
    });
    assert.deepEqual(linked.json().connection.projects, [{ id: project.id, name: "Linked project" }]);
    const viaProject = await call(app, cookie, "GET", `/api/projects/${project.id}/connections`);
    assert.equal(viaProject.json().connections[0].id, connection.id, "a linked connection shows up in the project");

    const refused = await call(app, cookie, "DELETE", `/api/admin/connections/${connection.id}`);
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.json().code, "CONNECTION_IN_USE");
    assert.equal(
      (await call(app, cookie, "DELETE", `/api/admin/connections/${connection.id}?force=true`)).statusCode,
      200,
    );
    assert.equal(
      (await call(app, cookie, "GET", `/api/projects/${project.id}/connections`)).json().connections.length,
      0,
    );
    assert.ok(
      !(await call(app, cookie, "GET", "/api/admin/connections"))
        .json()
        .connections.some((c: { id: string }) => c.id === connection.id),
    );

    const actions = (
      db.prepare("SELECT action FROM audit_log WHERE target_id = ? ORDER BY rowid").all(connection.id) as {
        action: string;
      }[]
    ).map((a) => a.action);
    assert.deepEqual(actions, ["dbconn.create", "dbconn.update", "dbconn.link", "dbconn.delete"]);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("a project administrator can only reach connections attached to their project, and cannot edit an admin-managed one", async () => {
  const app = await buildApp();
  try {
    const admin = await login(app, 1);
    const owner = await login(app, 0);
    const global = await createConnection(app, admin);
    const project = (await call(app, owner, "POST", "/api/projects", { name: "Owner project" })).json();
    const base = `/api/projects/${project.id}/connections/${global.id}`;

    // Not attached: knowing the id is not enough.
    assert.equal((await call(app, owner, "PUT", base, { name: "hijacked" })).statusCode, 404);
    assert.equal((await call(app, owner, "POST", `${base}/pull`, {})).statusCode, 404);
    assert.equal((await call(app, owner, "POST", `${base}/plan-deployment`, {})).statusCode, 404);
    assert.equal((await call(app, owner, "DELETE", base)).statusCode, 404);

    await call(app, admin, "PUT", `/api/admin/connections/${global.id}/projects`, { projectIds: [project.id] });
    // Attached: usable, but its settings stay the admin's.
    assert.equal((await call(app, owner, "POST", `${base}/pull`, {})).statusCode, 200);
    const edit = await call(app, owner, "PUT", base, { name: "hijacked" });
    assert.equal(edit.statusCode, 403);
    assert.equal(edit.json().code, "CONNECTION_MANAGED_BY_ADMIN");

    // Detaching from the project leaves the global connection in place…
    assert.equal((await call(app, owner, "DELETE", base)).statusCode, 200);
    assert.ok(
      (await call(app, admin, "GET", "/api/admin/connections"))
        .json()
        .connections.some((c: { id: string }) => c.id === global.id),
    );

    // …whereas one the project created itself goes with its last link.
    const own = (
      await call(app, owner, "POST", `/api/projects/${project.id}/connections`, {
        name: "Mine",
        engine: "sqlite",
        database: ":memory:",
      })
    ).json().connection;
    assert.equal(
      (await call(app, owner, "DELETE", `/api/projects/${project.id}/connections/${own.id}`)).statusCode,
      200,
    );
    assert.equal(db.prepare("SELECT 1 FROM db_connections WHERE id = ?").get(own.id), undefined);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("a read-only connection refuses deployment, write SQL and drops, but still reads", async () => {
  const app = await buildApp();
  try {
    resetConnectionBudgets();
    const cookie = await login(app, 1);
    const connection = await createConnection(app, cookie, { readOnly: true });
    const base = `/api/admin/connections/${connection.id}`;
    const project = (await call(app, cookie, "POST", "/api/projects", { name: "RO project" })).json();
    await call(app, cookie, "PUT", `${base}/projects`, { projectIds: [project.id] });

    const deploy = await call(
      app,
      cookie,
      "POST",
      `/api/projects/${project.id}/connections/${connection.id}/apply-deployment`,
      {},
    );
    assert.equal(deploy.json().code, "CONNECTION_READ_ONLY");
    assert.equal(
      (await call(app, cookie, "POST", `${base}/query`, { sql: "DELETE FROM users", readOnly: false })).json().code,
      "CONNECTION_READ_ONLY",
    );
    assert.equal(
      (
        await call(app, cookie, "POST", `${base}/drop`, {
          kind: "table",
          ref: { table: "users" },
          confirm: "users",
          execute: true,
        })
      ).json().code,
      "CONNECTION_READ_ONLY",
    );
    assert.equal(
      (await call(app, cookie, "POST", `${base}/query`, { sql: "SELECT COUNT(*) FROM users" })).json().result
        .rows[0][0],
      3,
    );
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("explorer and SQL console against a real SQLite target", async () => {
  const app = await buildApp();
  try {
    resetConnectionBudgets();
    const cookie = await login(app, 1);
    const connection = await createConnection(app, cookie);
    const base = `/api/admin/connections/${connection.id}`;

    const overview = (await call(app, cookie, "GET", `${base}/overview`)).json();
    assert.equal(overview.capabilities.users, false);
    assert.deepEqual(overview.databases, [{ name: "main", system: false, sizeBytes: null }]);

    const tables = (await call(app, cookie, "GET", `${base}/tables`)).json().tables;
    assert.deepEqual(
      tables.map((t: { name: string; kind: string }) => [t.name, t.kind]),
      [
        ["big_orders", "view"],
        ["orders", "table"],
        ["users", "table"],
      ],
    );

    const description = (await call(app, cookie, "GET", `${base}/table?table=orders`)).json().description;
    assert.deepEqual(
      description.columns.map((c: { name: string }) => c.name),
      ["id", "user_id", "total", "note"],
    );
    assert.equal(description.columns[0].primaryKey, true);
    assert.ok(
      description.indexes.some(
        (i: { name: string; columns: string[] }) => i.name === "idx_orders_user" && i.columns[0] === "user_id",
      ),
    );
    assert.equal(description.constraints[0].type, "FOREIGN KEY");

    const page = (await call(app, cookie, "GET", `${base}/rows?table=users&limit=2&offset=0`)).json();
    assert.deepEqual(page.result.columns, ["id", "name", "email"]);
    assert.equal(page.result.rows.length, 2);
    assert.equal(page.result.truncated, true, "a third row exists");
    assert.equal(
      (await call(app, cookie, "GET", `${base}/rows?table=users&limit=2&offset=2`)).json().result.truncated,
      false,
    );

    // Read-only is the default, enforced by the guard *and* by a read-only file handle.
    const select = (
      await call(app, cookie, "POST", `${base}/query`, { sql: "SELECT name FROM users ORDER BY id;" })
    ).json().result;
    assert.deepEqual(select.rows, [["Ada"], ["Linus"], ["Grace"]]);
    const blocked = await call(app, cookie, "POST", `${base}/query`, { sql: "DELETE FROM users" });
    assert.equal(blocked.statusCode, 400);
    assert.equal(blocked.json().code, "DB_ADMIN_WRITE_NOT_ALLOWED");
    assert.equal(
      (await call(app, cookie, "POST", `${base}/query`, { sql: "SELECT 1; DELETE FROM users" })).json().code,
      "DB_ADMIN_WRITE_NOT_ALLOWED",
    );
    assert.equal(
      (await call(app, cookie, "POST", `${base}/query`, { sql: "SELECT * FROM users", maxRows: 1 })).json().result
        .truncated,
      true,
    );

    const failed = await call(app, cookie, "POST", `${base}/query`, { sql: "SELECT * FROM nope" });
    assert.equal(failed.statusCode, 502);
    assert.match(failed.json().error, /no such table/);

    const write = (
      await call(app, cookie, "POST", `${base}/query`, {
        sql: "UPDATE users SET name = 'Ada L.' WHERE id = 1",
        readOnly: false,
      })
    ).json().result;
    assert.equal(write.rowCount, 1);

    const history = (await call(app, cookie, "GET", `${base}/query-history`)).json().history;
    assert.equal(history[0].sql, "UPDATE users SET name = 'Ada L.' WHERE id = 1");
    assert.equal(history[0].readOnly, false);
    assert.ok(
      history.some(
        (h: { success: boolean; error: string | null }) => !h.success && /no such table/.test(h.error ?? ""),
      ),
    );
    const audited = db
      .prepare("SELECT detail FROM audit_log WHERE action = 'dbadmin.query' AND target_id = ?")
      .all(connection.id) as { detail: string }[];
    assert.ok(audited.some((a) => a.detail.startsWith("WRITE ok 1 row(s)")));

    // SQLite has no accounts or sessions: a clear refusal, not a crash.
    assert.equal((await call(app, cookie, "GET", `${base}/principals`)).json().code, "DB_ADMIN_UNSUPPORTED");
    assert.equal((await call(app, cookie, "GET", `${base}/sessions`)).json().code, "DB_ADMIN_UNSUPPORTED");
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("drop: preview first, then only with the object's exact name typed back", async () => {
  const app = await buildApp();
  try {
    resetConnectionBudgets();
    const cookie = await login(app, 1);
    const connection = await createConnection(app, cookie);
    const base = `/api/admin/connections/${connection.id}`;
    const tableNames = async () =>
      (await call(app, cookie, "GET", `${base}/tables`)).json().tables.map((t: { name: string }) => t.name);

    const preview = await call(app, cookie, "POST", `${base}/drop`, {
      kind: "column",
      ref: { table: "orders", column: "note" },
    });
    assert.deepEqual(preview.json(), { sql: ['ALTER TABLE "orders" DROP COLUMN "note"'], executed: false });

    const wrong = await call(app, cookie, "POST", `${base}/drop`, {
      kind: "table",
      ref: { table: "orders" },
      confirm: "order",
      execute: true,
    });
    assert.equal(wrong.json().code, "DB_ADMIN_CONFIRMATION_MISMATCH");
    assert.ok((await tableNames()).includes("orders"));

    const unknown = await call(app, cookie, "POST", `${base}/drop`, {
      kind: "table",
      ref: { table: 'x"; DROP TABLE users; --' },
      execute: true,
    });
    assert.equal(unknown.json().code, "DB_ADMIN_INPUT_INVALID", "a name the server doesn't list is never interpolated");
    // A view is not a table: the kind has to match what the server says it is.
    assert.equal(
      (await call(app, cookie, "POST", `${base}/drop`, { kind: "table", ref: { table: "big_orders" } })).json().code,
      "DB_ADMIN_INPUT_INVALID",
    );

    assert.equal(
      (
        await call(app, cookie, "POST", `${base}/drop`, {
          kind: "view",
          ref: { table: "big_orders" },
          confirm: "big_orders",
          execute: true,
        })
      ).json().executed,
      true,
    );
    assert.equal(
      (
        await call(app, cookie, "POST", `${base}/drop`, {
          kind: "column",
          ref: { table: "orders", column: "note" },
          confirm: "note",
          execute: true,
        })
      ).json().executed,
      true,
    );
    assert.equal(
      (
        await call(app, cookie, "POST", `${base}/drop`, {
          kind: "table",
          ref: { table: "orders" },
          confirm: "orders",
          execute: true,
        })
      ).json().executed,
      true,
    );
    assert.deepEqual(await tableNames(), ["users"]);

    const drops = db
      .prepare("SELECT detail FROM audit_log WHERE action = 'dbadmin.drop' AND target_id = ? ORDER BY rowid")
      .all(connection.id) as { detail: string }[];
    assert.deepEqual(
      drops.map((d) => d.detail),
      ["view big_orders", "column orders.note", "table orders"],
    );
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("health check records status, version and latency; an unreachable target is 'offline', not an error", async () => {
  const app = await buildApp();
  try {
    resetConnectionBudgets();
    const cookie = await login(app, 1);
    const connection = await createConnection(app, cookie);
    const ok = (await call(app, cookie, "POST", `/api/admin/connections/${connection.id}/health`, {})).json().connection
      .health;
    assert.equal(ok.status, "online");
    assert.match(ok.version, /^SQLite/);
    assert.equal(typeof ok.latencyMs, "number");

    const broken = (
      await call(app, cookie, "POST", "/api/admin/connections", {
        name: "Own db",
        engine: "sqlite",
        filePath: process.env.ATHANORDB_DB_PATH,
      })
    ).json().connection;
    const res = await call(app, cookie, "POST", `/api/admin/connections/${broken.id}/health`, {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().connection.health.status, "offline");
    assert.match(res.json().connection.health.error, /own database/);
  } finally {
    closeAllRooms();
    await app.close();
  }
});
