import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseConnectionConfig } from "@athanordb/shared";

process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-credentials-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
process.env.ATHANORDB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { currentActorId, runInActorScope, setActor } = await import("../../infrastructure/actor.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");
const { resetConnectionBudgets } = await import("./connectionBudget.js");
const { credentialCheck } = await import("./credentialRoutes.js");
const { configForActor } = await import("./personalCredentials.js");
const { getConnectionById } = await import("./repository.js");

type App = Awaited<ReturnType<typeof buildApp>>;

const HOST = "localhost:3001";
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `http://${HOST}`, ...extra });

async function makeUser(app: App, isAdmin: 0 | 1 = 0) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?, NULL)").run(
    id,
    email,
    await hashPassword(password),
    isAdmin,
  );
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password },
  });
  return { id, email, cookie: `athanordb_sid=${res.cookies.find((c) => c.name === "athanordb_sid")!.value}` };
}

function call(app: App, cookie: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: headers({ cookie }),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

/** A PostgreSQL connection nothing listens behind: enough for everything but a real login. */
const UNREACHABLE = {
  name: "Shop",
  engine: "postgres",
  host: "127.0.0.1",
  port: 1,
  database: "shop",
  user: "athanor_service",
  password: "service-password",
};

/** A personal-mode connection attached to a project of `owner`. */
async function personalConnection(app: App, adminCookie: string, ownerCookie: string) {
  const project = (await call(app, ownerCookie, "POST", "/api/projects", { name: "Shop" })).json() as { id: string };
  const created = await call(app, adminCookie, "POST", "/api/admin/connections", {
    ...UNREACHABLE,
    authMode: "personal",
  });
  assert.equal(created.statusCode, 200, created.body);
  const connection = (created.json() as { connection: { id: string; authMode: string } }).connection;
  assert.equal(connection.authMode, "personal");
  const linked = await call(app, adminCookie, "PUT", `/api/admin/connections/${connection.id}/projects`, {
    projectIds: [project.id],
  });
  assert.equal(linked.statusCode, 200, linked.body);
  return { projectId: project.id, connectionId: connection.id };
}

test("personal accounts: which connections may ask for them, and who decides", async () => {
  const app = await buildApp();
  try {
    const admin = await makeUser(app, 1);
    const owner = await makeUser(app);

    // Nothing to replace in a SQLite file or inside a connection string.
    const sqlite = await call(app, admin.cookie, "POST", "/api/admin/connections", {
      name: "File",
      engine: "sqlite",
      filePath: join(tmpdir(), `${randomUUID()}.sqlite`),
      authMode: "personal",
    });
    assert.equal(sqlite.statusCode, 400);
    assert.equal(sqlite.json().code, "CONNECTION_AUTH_MODE_INVALID");
    const url = await call(app, admin.cookie, "POST", "/api/admin/connections", {
      name: "Url",
      engine: "postgres",
      connectionString: "postgres://someone:secret@127.0.0.1:1/shop",
      authMode: "personal",
    });
    assert.equal(url.statusCode, 400);
    // Refused whole: no connection left behind as a shared one.
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM db_connections").get() as { n: number }).n, 0);
    const odd = await call(app, admin.cookie, "POST", "/api/admin/connections", { ...UNREACHABLE, authMode: "each" });
    assert.equal(odd.json().code, "CONNECTION_AUTH_MODE_INVALID");

    // Shared unless said otherwise.
    const plain = (await call(app, admin.cookie, "POST", "/api/admin/connections", UNREACHABLE)).json().connection;
    assert.equal(plain.authMode, "shared");

    const { projectId, connectionId } = await personalConnection(app, admin.cookie, owner.cookie);
    // A project route does not change the mode, whatever it sends.
    const fromProject = await call(app, admin.cookie, "PUT", `/api/projects/${projectId}/connections/${connectionId}`, {
      authMode: "shared",
    });
    assert.equal(fromProject.statusCode, 200, fromProject.body);
    assert.equal(getConnectionById(connectionId)!.authMode, "personal");

    // The administrator's change is its own line in the trail.
    const back = await call(app, admin.cookie, "PUT", `/api/admin/connections/${connectionId}`, { authMode: "shared" });
    assert.equal(back.json().connection.authMode, "shared");
    const trail = db.prepare("SELECT detail FROM audit_log WHERE action = 'dbconn.auth_mode'").all() as {
      detail: string;
    }[];
    assert.deepEqual(
      trail.map((entry) => entry.detail),
      ["Shop: personal -> shared"],
    );
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("personal accounts: given by those who use the connection, tried before being kept, never shown again", async () => {
  const app = await buildApp();
  const verify = mock.method(credentialCheck, "verify");
  try {
    resetConnectionBudgets();
    const admin = await makeUser(app, 1);
    const owner = await makeUser(app);
    const stranger = await makeUser(app);
    const { connectionId } = await personalConnection(app, admin.cookie, owner.cookie);
    const url = `/api/connections/${connectionId}/credentials`;

    assert.deepEqual((await call(app, owner.cookie, "GET", url)).json(), {
      authMode: "personal",
      username: null,
      updatedAt: null,
    });
    // Someone who administers no project of this connection is told it does not exist.
    assert.equal((await call(app, stranger.cookie, "GET", url)).statusCode, 404);
    assert.equal((await call(app, stranger.cookie, "PUT", url, { username: "x", password: "y" })).statusCode, 404);

    for (const body of [
      {},
      { username: "ada" },
      { username: " ", password: "x" },
      { username: "a\nb", password: "x" },
    ]) {
      const bad = await call(app, owner.cookie, "PUT", url, body);
      assert.equal(bad.json().code, "PERSONAL_CREDENTIALS_INVALID", JSON.stringify(body));
    }
    assert.equal(verify.mock.callCount(), 0, "nothing is tried with an account that is not one");

    // Nothing answers behind this connection: the account is refused, and not kept.
    const refused = await call(app, owner.cookie, "PUT", url, { username: "ada", password: "ada-password" });
    assert.equal(refused.statusCode, 400, refused.body);
    assert.equal(refused.json().code, "PERSONAL_CREDENTIALS_REJECTED");
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM db_connection_credentials").get() as { n: number }).n, 0);

    // The database accepts it (the one step a test cannot do for real).
    let tried: DatabaseConnectionConfig | undefined;
    verify.mock.mockImplementation(async (config: DatabaseConnectionConfig) => {
      tried = config;
    });
    const saved = await call(app, owner.cookie, "PUT", url, { username: " ada ", password: "ada-password" });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().username, "ada");
    assert.equal(saved.body.includes("ada-password"), false);
    // Tried as given, on the connection's own target — not as the service account.
    assert.deepEqual(
      [tried?.host, tried?.port, tried?.database, tried?.user, tried?.password, tried?.authMode],
      ["127.0.0.1", 1, "shop", "ada", "ada-password", "shared"],
    );

    const row = db.prepare("SELECT username, secret_encrypted FROM db_connection_credentials").get() as {
      username: string;
      secret_encrypted: string;
    };
    assert.equal(row.username, "ada");
    assert.equal(row.secret_encrypted.includes("ada-password"), false);
    const audited = db.prepare("SELECT detail FROM audit_log WHERE action = 'dbconn.credentials.set'").all() as {
      detail: string;
    }[];
    assert.deepEqual(
      audited.map((entry) => entry.detail),
      ["Shop: ada"],
    );

    // Administrators see who gave an account, not what it is.
    const holders = await call(app, admin.cookie, "GET", `/api/admin/connections/${connectionId}/credentials`);
    assert.deepEqual(
      (holders.json().holders as { email: string; username: string }[]).map((h) => [h.email, h.username]),
      [[owner.email, "ada"]],
    );
    assert.equal(holders.body.includes("ada-password"), false);
    assert.equal(
      (await call(app, owner.cookie, "GET", `/api/admin/connections/${connectionId}/credentials`)).statusCode,
      403,
    );
    // It is in the account's own data export, by name.
    const exported = await call(app, owner.cookie, "GET", "/api/users/me/export");
    assert.equal(exported.statusCode, 200, exported.body);
    assert.deepEqual(
      (exported.json().databaseAccounts as { connection: string; username: string }[]).map((a) => [
        a.connection,
        a.username,
      ]),
      [["Shop", "ada"]],
    );
    assert.equal(exported.body.includes("ada-password"), false);

    // Removed by its owner; a shared connection takes none.
    assert.equal((await call(app, owner.cookie, "DELETE", url)).json().username, null);
    await call(app, admin.cookie, "PUT", `/api/admin/connections/${connectionId}`, { authMode: "shared" });
    const unused = await call(app, owner.cookie, "PUT", url, { username: "ada", password: "ada-password" });
    assert.equal(unused.statusCode, 409);
    assert.equal(unused.json().code, "PERSONAL_CREDENTIALS_NOT_USED");
  } finally {
    verify.mock.restore();
    closeAllRooms();
    await app.close();
  }
});

test("personal accounts: a person connects as themselves or not at all; unattended work uses the service account", async () => {
  const app = await buildApp();
  const verify = mock.method(credentialCheck, "verify", async () => {});
  try {
    resetConnectionBudgets();
    const admin = await makeUser(app, 1);
    const owner = await makeUser(app);
    const { projectId, connectionId } = await personalConnection(app, admin.cookie, owner.cookie);
    const stored = getConnectionById(connectionId)!;

    // No account: refused before anything is opened — console, deployment plan.
    const plan = `/api/projects/${projectId}/connections/${connectionId}/plan-deployment`;
    for (const [cookie, method, url] of [
      [admin.cookie, "GET", `/api/admin/connections/${connectionId}/overview`],
      [owner.cookie, "POST", plan],
    ] as const) {
      const res = await call(app, cookie, method, url, method === "POST" ? {} : undefined);
      assert.equal(res.statusCode, 409, `${url}: ${res.body}`);
      assert.equal(res.json().code, "PERSONAL_CREDENTIALS_REQUIRED");
      assert.equal(res.json().connectionName, "Shop");
    }

    // "Is it up?" is asked as the service account, whoever asks: the answer is about the database.
    const health = await call(app, admin.cookie, "POST", `/api/admin/connections/${connectionId}/health`, {});
    assert.equal(health.statusCode, 200, health.body);
    assert.doesNotMatch(health.json().connection.health.error as string, /personal accounts/);

    // With one, the request gets as far as the database (which is not there).
    const given = await call(app, owner.cookie, "PUT", `/api/connections/${connectionId}/credentials`, {
      username: "ada",
      password: "ada-password",
    });
    assert.equal(given.statusCode, 200, given.body);
    const planned = await call(app, owner.cookie, "POST", plan, {});
    assert.notEqual(planned.json().code, "PERSONAL_CREDENTIALS_REQUIRED", planned.body);
    assert.notEqual(planned.statusCode, 200);
    // Somebody else's account is not anybody's: the administrator still has none.
    assert.equal(
      (await call(app, admin.cookie, "GET", `/api/admin/connections/${connectionId}/overview`)).json().code,
      "PERSONAL_CREDENTIALS_REQUIRED",
    );

    // What a driver is opened with, by who is asking.
    const asOwner = runInActorScope(() => {
      setActor(owner.id);
      return configForActor(stored);
    });
    assert.deepEqual([asOwner.user, asOwner.password], ["ada", "ada-password"]);
    assert.throws(
      () =>
        runInActorScope(() => {
          setActor(admin.id);
          return configForActor(stored);
        }),
      /personal accounts/,
    );
    // Nobody behind it (a scheduled job, or this test's own body): the service account.
    assert.equal(currentActorId(), null, "a request's actor does not outlive the request");
    assert.deepEqual(
      [configForActor(stored).user, configForActor(stored).password],
      ["athanor_service", "service-password"],
    );
    // A shared connection is everybody's, as before.
    const shared = { ...stored, authMode: "shared" as const };
    assert.equal(
      runInActorScope(() => {
        setActor(admin.id);
        return configForActor(shared);
      }).user,
      "athanor_service",
    );

    // The accounts go with the user, and with the connection.
    const other = await makeUser(app);
    db.prepare(
      "INSERT INTO db_connection_credentials (id, connection_id, user_id, username, secret_encrypted) VALUES (?, ?, ?, 'x', 'y')",
    ).run(randomUUID(), connectionId, other.id);
    assert.equal((await call(app, admin.cookie, "DELETE", `/api/users/${other.id}`)).statusCode, 200);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM db_connection_credentials").get() as { n: number }).n, 1);
    const removed = await call(app, admin.cookie, "DELETE", `/api/admin/connections/${connectionId}?force=true`);
    assert.equal(removed.statusCode, 200, removed.body);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM db_connection_credentials").get() as { n: number }).n, 0);
  } finally {
    verify.mock.restore();
    closeAllRooms();
    await app.close();
  }
});

test("personal accounts: one list of the caller's own, limited to the connections they may use", async () => {
  const app = await buildApp();
  const verify = mock.method(credentialCheck, "verify", async () => {});
  try {
    resetConnectionBudgets();
    const admin = await makeUser(app, 1);
    const owner = await makeUser(app);
    const stranger = await makeUser(app);
    const { connectionId } = await personalConnection(app, admin.cookie, owner.cookie);
    // A shared connection never shows up in it.
    await call(app, admin.cookie, "POST", "/api/admin/connections", { ...UNREACHABLE, name: "Shared" });

    assert.equal((await call(app, stranger.cookie, "GET", "/api/me/sql-accounts")).statusCode, 200);
    assert.deepEqual((await call(app, stranger.cookie, "GET", "/api/me/sql-accounts")).json(), { accounts: [] });

    const before = (await call(app, owner.cookie, "GET", "/api/me/sql-accounts")).json().accounts;
    assert.deepEqual(
      before.map((a: { connectionId: string; username: string | null }) => [a.connectionId, a.username]),
      [[connectionId, null]],
    );

    await call(app, owner.cookie, "PUT", `/api/connections/${connectionId}/credentials`, {
      username: "ada",
      password: "ada-password",
    });
    const after = await call(app, owner.cookie, "GET", "/api/me/sql-accounts");
    assert.equal(after.json().accounts[0].username, "ada");
    assert.equal(after.json().accounts[0].connectionName, "Shop");
    assert.equal(after.body.includes("ada-password"), false);

    // Someone else's account is not theirs: the list is per caller.
    assert.equal((await call(app, admin.cookie, "GET", "/api/me/sql-accounts")).json().accounts[0].username, null);
  } finally {
    verify.mock.restore();
    closeAllRooms();
    await app.close();
  }
});
