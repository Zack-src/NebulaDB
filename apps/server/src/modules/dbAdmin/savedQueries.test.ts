import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

// Same rationale as `app.test.ts`: env vars must land before anything
// transitively imports `db.ts`/`shared/crypto.ts`.
await useTestDatabase("savedqueries");
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { createApiKey } = await import("../apiKeys/repository.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");
const { resetConnectionBudgets } = await import("../connections/connectionBudget.js");
const { deleteUserAccount } = await import("../users/service.js");

type App = Awaited<ReturnType<typeof buildApp>>;
type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

const HOST = "localhost:3001";
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `http://${HOST}`, ...extra });
const PASSWORD = "correct horse battery staple";

async function makeUser(app: App, isAdmin: 0 | 1 = 0, displayName: string | null = null) {
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  await db
    .prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?, ?)")
    .run(id, email, await hashPassword(PASSWORD), isAdmin, displayName);
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

function seedTarget(): string {
  const file = join(tmpdir(), `nebuladb-test-savedqueries-target-${randomUUID()}.sqlite`);
  const target = new Database(file);
  target.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO customers (name) VALUES ('Ada'), ('Linus');
  `);
  target.close();
  return file;
}

async function sqliteConnection(app: App, adminCookie: string) {
  const res = await call(app, adminCookie, "POST", "/api/admin/connections", {
    name: `Target ${randomUUID().slice(0, 6)}`,
    engine: "sqlite",
    filePath: seedTarget(),
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json().connection as { id: string };
}

const grant = (app: App, adminCookie: string, userId: string, connectionId: string, level: "read" | "write") =>
  call(app, adminCookie, "PUT", `/api/admin/users/${userId}/db-access`, { grants: [{ connectionId, level }] });

const saved = (id: string, suffix = "") => `/api/connections/${id}/saved-queries${suffix}`;

async function fixture() {
  const app = await buildApp();
  resetConnectionBudgets();
  const admin = await makeUser(app, 1);
  const connection = await sqliteConnection(app, admin.cookie);
  return { app, admin, connection };
}

test("a saved query is private to its author until shared, then read-only for everyone with access", async () => {
  const { app, admin, connection } = await fixture();
  try {
    const ada = await makeUser(app, 0, "Ada L.");
    const bob = await makeUser(app);
    await grant(app, admin.cookie, ada.id, connection.id, "read");
    await grant(app, admin.cookie, bob.id, connection.id, "read");

    const created = await call(app, ada.cookie, "POST", saved(connection.id), {
      name: "  All customers ",
      sql: "SELECT * FROM customers",
      description: "daily check",
    });
    assert.equal(created.statusCode, 201, created.body);
    const query = created.json().query;
    assert.equal(query.name, "All customers");
    assert.equal(query.shared, false);
    assert.equal(query.mine, true);
    assert.equal(query.authorName, "Ada L.");

    // Private: Bob sees nothing, can neither read, change nor delete it.
    assert.deepEqual((await call(app, bob.cookie, "GET", saved(connection.id))).json().queries, []);
    assert.equal(
      (await call(app, bob.cookie, "PATCH", saved(connection.id, `/${query.id}`), { name: "x" })).statusCode,
      404,
    );
    assert.equal((await call(app, bob.cookie, "DELETE", saved(connection.id, `/${query.id}`))).statusCode, 404);

    const shared = await call(app, ada.cookie, "PATCH", saved(connection.id, `/${query.id}`), { shared: true });
    assert.equal(shared.statusCode, 200, shared.body);
    const bobList = (await call(app, bob.cookie, "GET", saved(connection.id))).json().queries;
    assert.equal(bobList.length, 1);
    assert.equal(bobList[0].mine, false);
    assert.equal(bobList[0].authorName, "Ada L.");
    assert.equal(bobList[0].sql, "SELECT * FROM customers");

    // Shared is read-only for others.
    assert.equal(
      (await call(app, bob.cookie, "PATCH", saved(connection.id, `/${query.id}`), { sql: "DELETE FROM customers" }))
        .statusCode,
      403,
    );
    assert.equal((await call(app, bob.cookie, "DELETE", saved(connection.id, `/${query.id}`))).statusCode, 403);

    // Own queries come first, then the shared ones.
    await call(app, bob.cookie, "POST", saved(connection.id), { name: "Zed", sql: "SELECT 1" });
    assert.deepEqual(
      (await call(app, bob.cookie, "GET", saved(connection.id))).json().queries.map((q: { mine: boolean }) => q.mine),
      [true, false],
    );

    // Unsharing hides it again.
    await call(app, ada.cookie, "PATCH", saved(connection.id, `/${query.id}`), { shared: false });
    assert.equal((await call(app, bob.cookie, "GET", saved(connection.id))).json().queries.length, 1);

    for (const action of ["savedquery.create", "savedquery.share", "savedquery.unshare"]) {
      assert.ok(
        db
          .prepare("SELECT 1 FROM audit_log WHERE action = ? AND target_id = ? AND actor_id = ?")
          .get(action, connection.id, ada.id),
        action,
      );
    }
  } finally {
    await closeAllRooms();
    await app.close();
  }
});

test("someone without access to the connection sees nothing and can save nothing", async () => {
  const { app, admin, connection } = await fixture();
  try {
    const ada = await makeUser(app);
    const stranger = await makeUser(app);
    await grant(app, admin.cookie, ada.id, connection.id, "read");
    const query = (await call(app, ada.cookie, "POST", saved(connection.id), { name: "Q", sql: "SELECT 1" })).json()
      .query;
    await call(app, ada.cookie, "PATCH", saved(connection.id, `/${query.id}`), { shared: true });

    assert.equal((await call(app, stranger.cookie, "GET", saved(connection.id))).statusCode, 404);
    assert.equal(
      (await call(app, stranger.cookie, "POST", saved(connection.id), { name: "Q", sql: "SELECT 1" })).statusCode,
      404,
    );
    assert.equal((await call(app, stranger.cookie, "DELETE", saved(connection.id, `/${query.id}`))).statusCode, 404);
    // Not through the admin routes either.
    assert.equal(
      (await call(app, stranger.cookie, "GET", `/api/admin/connections/${connection.id}/saved-queries`)).statusCode,
      403,
    );
    // Nor with an API key, even the member's own.
    const key = (await createApiKey(ada.id, "saved", ["projects:read"], null)).plaintextKey;
    assert.equal((await call(app, key, "GET", saved(connection.id))).statusCode, 401);
    // A revoked grant applies to the next request.
    await call(app, admin.cookie, "PUT", `/api/admin/users/${ada.id}/db-access`, { grants: [] });
    assert.equal((await call(app, ada.cookie, "GET", saved(connection.id))).statusCode, 404);
  } finally {
    await closeAllRooms();
    await app.close();
  }
});

test("names are unique per person and connection; overwriting is explicit", async () => {
  const { app, admin, connection } = await fixture();
  try {
    const other = await sqliteConnection(app, admin.cookie);
    const ada = await makeUser(app);
    const bob = await makeUser(app);
    for (const user of [ada, bob]) {
      await grant(app, admin.cookie, user.id, connection.id, "read");
    }
    const create = (cookie: string, id: string, body: Record<string, unknown>) =>
      call(app, cookie, "POST", saved(id), body);

    assert.equal((await create(ada.cookie, connection.id, { name: "Q", sql: "SELECT 1" })).statusCode, 201);
    const clash = await create(ada.cookie, connection.id, { name: "Q", sql: "SELECT 2" });
    assert.equal(clash.statusCode, 409);
    assert.equal(clash.json().code, "SAVED_QUERY_NAME_TAKEN");
    assert.equal((await call(app, ada.cookie, "GET", saved(connection.id))).json().queries[0].sql, "SELECT 1");

    const overwritten = await create(ada.cookie, connection.id, { name: "Q", sql: "SELECT 2", overwrite: true });
    assert.equal(overwritten.statusCode, 200, overwritten.body);
    assert.equal(overwritten.json().query.sql, "SELECT 2");
    assert.equal((await call(app, ada.cookie, "GET", saved(connection.id))).json().queries.length, 1);

    // The same name is free for another person (even next to a shared one) and on another connection.
    assert.equal((await create(bob.cookie, connection.id, { name: "Q", sql: "SELECT 3" })).statusCode, 201);
    assert.equal((await create(admin.cookie, other.id, { name: "Q", sql: "SELECT 4" })).statusCode, 201);

    // Renaming onto an existing own name is refused, renaming to itself is not.
    const second = (await create(ada.cookie, connection.id, { name: "R", sql: "SELECT 5" })).json().query;
    assert.equal(
      (await call(app, ada.cookie, "PATCH", saved(connection.id, `/${second.id}`), { name: "Q" })).statusCode,
      409,
    );
    const renamed = await call(app, ada.cookie, "PATCH", saved(connection.id, `/${second.id}`), { name: "R2" });
    assert.equal(renamed.json().query.name, "R2");
    assert.equal(
      (await call(app, ada.cookie, "PATCH", saved(connection.id, `/${second.id}`), { name: "R2" })).statusCode,
      200,
    );
  } finally {
    await closeAllRooms();
    await app.close();
  }
});

test("a name, a statement and a description are bounded; a count too", async () => {
  const { app, admin, connection } = await fixture();
  try {
    const post = (body: Record<string, unknown>) => call(app, admin.cookie, "POST", saved(connection.id), body);
    assert.equal((await post({ name: "n".repeat(120), sql: "SELECT 1" })).statusCode, 201);
    for (const body of [
      { name: "n".repeat(121), sql: "SELECT 1" },
      { name: "   ", sql: "SELECT 1" },
      { sql: "SELECT 1" },
      { name: 12, sql: "SELECT 1" },
      { name: "a", sql: "   " },
      { name: "a", sql: 4 },
      { name: "a", sql: "x".repeat(200_001) },
      { name: "a", sql: "SELECT 1", description: "d".repeat(501) },
    ]) {
      const res = await post(body);
      assert.equal(res.statusCode, 400, JSON.stringify(body).slice(0, 80));
      assert.equal(res.json().code, "SAVED_QUERY_INVALID");
    }
    assert.equal((await post({ name: "big", sql: "x".repeat(200_000) })).statusCode, 201);

    const insert = db.prepare(
      "INSERT INTO saved_queries (id, connection_id, user_id, name, sql) VALUES (?, ?, ?, ?, ?)",
    );
    const adminId = admin.id;
    const count = (
      (await db.prepare("SELECT COUNT(*) AS n FROM saved_queries WHERE user_id = ?").get(adminId)) as { n: number }
    ).n;
    for (let i = count; i < 200; i++) await insert.run(randomUUID(), connection.id, adminId, `fill ${i}`, "SELECT 1");
    const full = await post({ name: "one too many", sql: "SELECT 1" });
    assert.equal(full.statusCode, 409);
    assert.equal(full.json().code, "SAVED_QUERY_LIMIT");
    // Overwriting at the ceiling is still allowed.
    assert.equal((await post({ name: "big", sql: "SELECT 2", overwrite: true })).statusCode, 200);
  } finally {
    await closeAllRooms();
    await app.close();
  }
});

test("only the author edits or deletes; an administrator can delete any", async () => {
  const { app, admin, connection } = await fixture();
  try {
    const ada = await makeUser(app);
    await grant(app, admin.cookie, ada.id, connection.id, "write");
    const priv = (await call(app, ada.cookie, "POST", saved(connection.id), { name: "P", sql: "SELECT 1" })).json()
      .query;
    const pub = (await call(app, ada.cookie, "POST", saved(connection.id), { name: "S", sql: "SELECT 2" })).json()
      .query;
    await call(app, ada.cookie, "PATCH", saved(connection.id, `/${pub.id}`), { shared: true });

    // The administrator does not edit another's query, but deletes it, private or shared.
    assert.equal(
      (await call(app, admin.cookie, "PATCH", saved(connection.id, `/${pub.id}`), { name: "mine now" })).statusCode,
      403,
    );
    assert.equal(
      (await call(app, admin.cookie, "DELETE", `/api/admin/connections/${connection.id}/saved-queries/${priv.id}`))
        .statusCode,
      200,
    );
    assert.equal((await call(app, admin.cookie, "DELETE", saved(connection.id, `/${pub.id}`))).statusCode, 200);
    assert.equal((await call(app, ada.cookie, "GET", saved(connection.id))).json().queries.length, 0);
    assert.equal((await call(app, ada.cookie, "DELETE", saved(connection.id, `/${pub.id}`))).statusCode, 404);
    assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'savedquery.delete' AND actor_id = ?").get(admin.id));
    assert.equal(
      (await call(app, ada.cookie, "PATCH", saved(connection.id, `/${pub.id}`), { name: "x" })).statusCode,
      404,
    );
  } finally {
    await closeAllRooms();
    await app.close();
  }
});

test("saving gives no right: a read member can save a write and is refused when running it", async () => {
  const { app, admin, connection } = await fixture();
  try {
    const ada = await makeUser(app);
    await grant(app, admin.cookie, ada.id, connection.id, "read");
    const writing = "DELETE FROM customers";
    const created = await call(app, ada.cookie, "POST", saved(connection.id), { name: "Wipe", sql: writing });
    assert.equal(created.statusCode, 201);
    const sql = created.json().query.sql;
    // Read-only by default, like a typed statement.
    const asTyped = await call(app, ada.cookie, "POST", `/api/connections/${connection.id}/query`, { sql });
    assert.equal(asTyped.statusCode, 400, asTyped.body);
    const forced = await call(app, ada.cookie, "POST", `/api/connections/${connection.id}/query`, {
      sql,
      readOnly: false,
      confirmWrite: true,
    });
    assert.equal(forced.statusCode, 403);
    assert.equal(forced.json().code, "DB_ACCESS_WRITE_FORBIDDEN");
  } finally {
    await closeAllRooms();
    await app.close();
  }
});

test("saved queries go with the connection and with the account", async () => {
  const { app, admin, connection } = await fixture();
  try {
    const other = await sqliteConnection(app, admin.cookie);
    const ada = await makeUser(app);
    const bob = await makeUser(app);
    for (const user of [ada, bob]) {
      await grant(app, admin.cookie, user.id, connection.id, "read");
    }
    const create = (cookie: string, id: string, name: string) =>
      call(app, cookie, "POST", saved(id), { name, sql: "SELECT 1" });
    const shared = (await create(ada.cookie, connection.id, "A")).json().query;
    await call(app, ada.cookie, "PATCH", saved(connection.id, `/${shared.id}`), { shared: true });
    await create(bob.cookie, connection.id, "B");
    await create(admin.cookie, other.id, "Elsewhere");
    const rows = async (id: string) =>
      ((await db.prepare("SELECT COUNT(*) AS n FROM saved_queries WHERE connection_id = ?").get(id)) as { n: number })
        .n;
    assert.equal(await rows(connection.id), 2);

    // Deleting the account removes what it saved, shared ones included.
    await deleteUserAccount(ada.id, ada.email, null);
    assert.equal(await rows(connection.id), 1);
    assert.deepEqual(
      (await call(app, bob.cookie, "GET", saved(connection.id))).json().queries.map((q: { name: string }) => q.name),
      ["B"],
    );

    const removed = await call(app, admin.cookie, "DELETE", `/api/admin/connections/${connection.id}?force=true`);
    assert.equal(removed.statusCode, 200, removed.body);
    assert.equal(await rows(connection.id), 0);
    assert.equal(await rows(other.id), 1);
  } finally {
    await closeAllRooms();
    await app.close();
  }
});
