import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseConnectionConfig } from "@nebuladb/shared";

process.env.NEBULADB_DB_PATH = join(tmpdir(), `nebuladb-test-credentials-api-${randomUUID()}.sqlite`);
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { createApiKey } = await import("../apiKeys/repository.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");
const { resetConnectionBudgets } = await import("./connectionBudget.js");
// The app's routes re-export the object `/api/v1` uses too: one seam for both.
const { credentialCheck } = await import("./credentialRoutes.js");

/**
 * Personal database accounts under `/api/v1` — the same rules as the app's
 * routes (`credentialRoutes.test.ts`), reached with an API key.
 */

type App = Awaited<ReturnType<typeof buildApp>>;
type Scope = Parameters<typeof createApiKey>[2][number];
type Method = "GET" | "POST" | "PUT" | "DELETE";

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
  return { id, email, cookie: `nebuladb_sid=${res.cookies.find((c) => c.name === "nebuladb_sid")!.value}` };
}

function send(app: App, auth: Record<string, string>, method: Method, url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: headers(auth),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

const withCookie = (app: App, cookie: string, method: Method, url: string, payload?: unknown) =>
  send(app, { cookie }, method, url, payload);
const withKey = (app: App, key: string, method: Method, url: string, payload?: unknown) =>
  send(app, { authorization: `Bearer ${key}` }, method, url, payload);

const keyOf = (userId: string, scopes: Scope[], projectId: string | null = null) =>
  createApiKey(userId, "ci", scopes, projectId).plaintextKey;

/** A PostgreSQL connection nothing listens behind: enough for everything but a real login. */
const UNREACHABLE = {
  engine: "postgres",
  host: "127.0.0.1",
  port: 1,
  database: "shop",
  user: "nebula_service",
  password: "service-password",
};

async function makeProject(app: App, cookie: string, name: string) {
  return ((await withCookie(app, cookie, "POST", "/api/projects", { name })).json() as { id: string }).id;
}

/** A connection of the admin console, attached to the projects given. */
async function makeConnection(
  app: App,
  adminCookie: string,
  name: string,
  projectIds: string[],
  authMode = "personal",
) {
  const created = await withCookie(app, adminCookie, "POST", "/api/admin/connections", {
    ...UNREACHABLE,
    name,
    database: name.toLowerCase(),
    authMode,
  });
  assert.equal(created.statusCode, 200, created.body);
  const { id } = (created.json() as { connection: { id: string } }).connection;
  // The first project on the connection's own database, each further one on a database of its own.
  const links = projectIds.map((projectId, index) => ({
    projectId,
    database: index === 0 ? null : `${name.toLowerCase()}_${index}`,
  }));
  const linked = await withCookie(app, adminCookie, "PUT", `/api/admin/connections/${id}/projects`, { links });
  assert.equal(linked.statusCode, 200, linked.body);
  return id;
}

const credentialsOf = (connectionId: string) => `/api/v1/connections/${connectionId}/credentials`;
const ACCOUNT = { username: "ada", password: "ada-password" };

test("/api/v1 personal accounts: who reaches them — a key, its owner's rights, its scope, its project", async () => {
  const app = await buildApp();
  const verify = mock.method(credentialCheck, "verify", async () => {});
  try {
    resetConnectionBudgets();
    const admin = await makeUser(app, 1);
    const owner = await makeUser(app);
    const other = await makeUser(app);
    const stranger = await makeUser(app);
    const shopProject = await makeProject(app, owner.cookie, "Shop");
    const billingProject = await makeProject(app, owner.cookie, "Billing");
    const otherProject = await makeProject(app, other.cookie, "Other");
    const shop = await makeConnection(app, admin.cookie, "Shop", [shopProject]);
    const billing = await makeConnection(app, admin.cookie, "Billing", [billingProject]);
    // One server two projects use.
    const both = await makeConnection(app, admin.cookie, "Both", [shopProject, otherProject]);

    // No key, or one that is none: not signed in.
    for (const method of ["GET", "PUT", "DELETE"] as const) {
      const none = await send(app, {}, method, credentialsOf(shop), method === "PUT" ? ACCOUNT : undefined);
      assert.equal(none.statusCode, 401, `${method}: ${none.body}`);
      const fake = await withKey(app, "adb_nope", method, credentialsOf(shop), method === "PUT" ? ACCOUNT : undefined);
      assert.equal(fake.statusCode, 401, `${method}: ${fake.body}`);
    }

    // A key acts as its owner: someone who administers no project of this connection is told it does not exist,
    // whatever the key's scope.
    const strangerKey = keyOf(stranger.id, ["connections:manage"]);
    for (const method of ["GET", "PUT", "DELETE"] as const) {
      const res = await withKey(app, strangerKey, method, credentialsOf(shop), method === "PUT" ? ACCOUNT : undefined);
      assert.equal(res.statusCode, 404, `${method}: ${res.body}`);
      assert.equal(res.json().code, "CONNECTION_NOT_FOUND");
    }
    assert.equal((await withKey(app, strangerKey, "GET", credentialsOf(randomUUID()))).statusCode, 404);

    // The scope narrows what the owner could do: reading projects is not managing connections.
    const readKey = keyOf(owner.id, ["projects:read", "projects:write", "deployments:trigger"]);
    for (const method of ["GET", "PUT", "DELETE"] as const) {
      const res = await withKey(app, readKey, method, credentialsOf(shop), method === "PUT" ? ACCOUNT : undefined);
      assert.equal(res.statusCode, 403, `${method}: ${res.body}`);
      assert.equal(res.json().code, "API_SCOPE_INSUFFICIENT");
    }

    // A key restricted to one project: that project's connections, no other's — though its owner administers both.
    const shopKey = keyOf(owner.id, ["connections:manage"], shopProject);
    assert.deepEqual((await withKey(app, shopKey, "GET", credentialsOf(shop))).json(), {
      authMode: "personal",
      username: null,
      updatedAt: null,
    });
    assert.equal((await withKey(app, shopKey, "GET", credentialsOf(both))).statusCode, 200);
    for (const method of ["GET", "PUT", "DELETE"] as const) {
      const res = await withKey(app, shopKey, method, credentialsOf(billing), method === "PUT" ? ACCOUNT : undefined);
      assert.equal(res.statusCode, 403, `${method}: ${res.body}`);
      assert.equal(res.json().code, "API_KEY_PROJECT_RESTRICTED");
    }
    // The same for an instance administrator's key, who reaches every connection otherwise.
    const adminShopKey = keyOf(admin.id, ["connections:manage"], shopProject);
    assert.equal((await withKey(app, adminShopKey, "GET", credentialsOf(shop))).statusCode, 200);
    assert.equal(
      (await withKey(app, adminShopKey, "GET", credentialsOf(billing))).json().code,
      "API_KEY_PROJECT_RESTRICTED",
    );
    assert.equal(
      (await withKey(app, keyOf(admin.id, ["connections:manage"]), "GET", credentialsOf(billing))).statusCode,
      200,
    );
    // The right to use the connection has to come from the key's project: `other` uses "Both" through their own
    // project, which a key held to the shop's project does not reach.
    assert.equal(
      (await withKey(app, keyOf(other.id, ["connections:manage"]), "GET", credentialsOf(both))).statusCode,
      200,
    );
    assert.equal(
      (await withKey(app, keyOf(other.id, ["connections:manage"], shopProject), "GET", credentialsOf(both))).json()
        .code,
      "API_KEY_PROJECT_RESTRICTED",
    );

    // Nothing above was tried on a database, kept or written down.
    assert.equal(verify.mock.callCount(), 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM db_connection_credentials").get() as { n: number }).n, 0);
    assert.equal(
      (
        db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'dbconn.credentials.%'").get() as {
          n: number;
        }
      ).n,
      0,
    );

    // A browser session is not narrowed by any scope, here as on the rest of /api/v1.
    assert.equal((await withCookie(app, owner.cookie, "GET", credentialsOf(billing))).statusCode, 200);
  } finally {
    verify.mock.restore();
    closeAllRooms();
    await app.close();
  }
});

test("/api/v1 personal accounts: given with a key, tried before being kept, never shown again", async () => {
  const app = await buildApp();
  const verify = mock.method(credentialCheck, "verify");
  try {
    resetConnectionBudgets();
    const admin = await makeUser(app, 1);
    const owner = await makeUser(app);
    const project = await makeProject(app, owner.cookie, "Shop");
    const shop = await makeConnection(app, admin.cookie, "Shop", [project]);
    const key = keyOf(owner.id, ["connections:manage"], project);
    const url = credentialsOf(shop);

    for (const body of [{}, { username: "ada" }, { username: "a\nb", password: "x" }]) {
      const bad = await withKey(app, key, "PUT", url, body);
      assert.equal(bad.statusCode, 400, bad.body);
      assert.equal(bad.json().code, "PERSONAL_CREDENTIALS_INVALID", JSON.stringify(body));
    }
    assert.equal(verify.mock.callCount(), 0, "nothing is tried with an account that is not one");

    // Nothing answers behind this connection: the account is refused, and not kept.
    const refused = await withKey(app, key, "PUT", url, ACCOUNT);
    assert.equal(refused.statusCode, 400, refused.body);
    assert.equal(refused.json().code, "PERSONAL_CREDENTIALS_REJECTED");
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM db_connection_credentials").get() as { n: number }).n, 0);

    // The database accepts it (the one step a test cannot do for real).
    let tried: DatabaseConnectionConfig | undefined;
    verify.mock.mockImplementation(async (config: DatabaseConnectionConfig) => {
      tried = config;
    });
    const saved = await withKey(app, key, "PUT", url, { username: " ada ", password: "ada-password" });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(Object.keys(saved.json()).sort(), ["authMode", "updatedAt", "username"]);
    assert.equal(saved.json().username, "ada");
    assert.equal(saved.body.includes("ada-password"), false);
    // Tried as given, on the connection's own target — not as the service account.
    assert.deepEqual(
      [tried?.host, tried?.port, tried?.database, tried?.user, tried?.password, tried?.authMode],
      ["127.0.0.1", 1, "shop", "ada", "ada-password", "shared"],
    );

    // Kept as the key owner's account, its password encrypted.
    const rows = db.prepare("SELECT user_id, username, secret_encrypted FROM db_connection_credentials").all() as {
      user_id: string;
      username: string;
      secret_encrypted: string;
    }[];
    assert.deepEqual(
      rows.map((row) => [row.user_id, row.username]),
      [[owner.id, "ada"]],
    );
    assert.equal(rows[0].secret_encrypted.includes("ada-password"), false);

    // Read back by name only — by the key, and by its owner in the app: it is one and the same account.
    const read = await withKey(app, key, "GET", url);
    assert.equal(read.json().username, "ada");
    assert.equal(typeof read.json().updatedAt, "string");
    assert.equal(read.body.includes("ada-password"), false);
    const inApp = await withCookie(app, owner.cookie, "GET", `/api/connections/${shop}/credentials`);
    assert.deepEqual(inApp.json(), read.json());
    // Somebody else's is not anybody's.
    assert.equal((await withKey(app, keyOf(admin.id, ["connections:manage"]), "GET", url)).json().username, null);

    const trail = () =>
      db
        .prepare(
          "SELECT action, actor_id, target_id, detail FROM audit_log WHERE action LIKE 'dbconn.credentials.%' ORDER BY rowid",
        )
        .all() as { action: string; actor_id: string; target_id: string; detail: string }[];
    assert.deepEqual(trail(), [
      { action: "dbconn.credentials.set", actor_id: owner.id, target_id: shop, detail: "Shop: ada (v1)" },
    ]);
    assert.equal(JSON.stringify(db.prepare("SELECT * FROM audit_log").all()).includes("ada-password"), false);

    // Removed by its owner — once: there is nothing to write down the second time.
    assert.equal((await withKey(app, key, "DELETE", url)).json().username, null);
    assert.equal((await withKey(app, key, "DELETE", url)).statusCode, 200);
    assert.deepEqual(
      trail().map((entry) => [entry.action, entry.detail]),
      [
        ["dbconn.credentials.set", "Shop: ada (v1)"],
        ["dbconn.credentials.remove", "Shop (v1)"],
      ],
    );
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM db_connection_credentials").get() as { n: number }).n, 0);

    // A connection that uses one shared account takes none.
    const tries = verify.mock.callCount();
    await withCookie(app, admin.cookie, "PUT", `/api/admin/connections/${shop}`, { authMode: "shared" });
    const unused = await withKey(app, key, "PUT", url, ACCOUNT);
    assert.equal(unused.statusCode, 409, unused.body);
    assert.equal(unused.json().code, "PERSONAL_CREDENTIALS_NOT_USED");
    assert.equal(verify.mock.callCount(), tries);
    assert.equal((await withKey(app, key, "GET", url)).json().authMode, "shared");
  } finally {
    verify.mock.restore();
    closeAllRooms();
    await app.close();
  }
});

test("/api/v1 personal accounts: a key's job is refused until its owner has given an account, and no longer after", async () => {
  const app = await buildApp();
  const verify = mock.method(credentialCheck, "verify", async () => {});
  try {
    resetConnectionBudgets();
    const admin = await makeUser(app, 1);
    const owner = await makeUser(app);
    const project = await makeProject(app, owner.cookie, "Shop");
    const shop = await makeConnection(app, admin.cookie, "Shop", [project]);
    // What a CI job is given: one project, read it, deploy it, and manage its connections.
    const key = keyOf(owner.id, ["projects:read", "deployments:trigger", "connections:manage"], project);
    const connection = `/api/v1/projects/${project}/connections/${shop}`;
    const opening = [`${connection}/pull`, `${connection}/deploy`] as const;

    // No account: refused before anything is opened, and told which connection asks.
    for (const url of opening) {
      const res = await withKey(app, key, "POST", url, {});
      assert.equal(res.statusCode, 409, `${url}: ${res.body}`);
      assert.equal(res.json().code, "PERSONAL_CREDENTIALS_REQUIRED");
      assert.equal(res.json().connectionName, "Shop");
    }
    // The check of what changed outside the schema reads as the service account, whoever asks: never refused for that.
    const check = await withKey(app, key, "POST", `/api/v1/projects/${project}/monitoring/check`, {});
    assert.equal(check.statusCode, 200, check.body);

    const given = await withKey(app, key, "PUT", credentialsOf(shop), ACCOUNT);
    assert.equal(given.statusCode, 200, given.body);

    // With one, the same requests get as far as the database (which is not there).
    for (const url of opening) {
      const res = await withKey(app, key, "POST", url, {});
      assert.notEqual(res.json().code, "PERSONAL_CREDENTIALS_REQUIRED", `${url}: ${res.body}`);
      assert.notEqual(res.statusCode, 200, `${url}: ${res.body}`);
      assert.notEqual(res.statusCode, 409, `${url}: ${res.body}`);
    }

    // Taken back, it is asked for again.
    assert.equal((await withKey(app, key, "DELETE", credentialsOf(shop))).statusCode, 200);
    assert.equal((await withKey(app, key, "POST", opening[0], {})).json().code, "PERSONAL_CREDENTIALS_REQUIRED");
  } finally {
    verify.mock.restore();
    closeAllRooms();
    await app.close();
  }
});

test("/api/v1 personal accounts: giving one is limited like the app's route — no way to try passwords", async () => {
  const app = await buildApp();
  const verify = mock.method(credentialCheck, "verify", async () => {
    throw new Error("password authentication failed");
  });
  try {
    resetConnectionBudgets();
    const admin = await makeUser(app, 1);
    const owner = await makeUser(app);
    const project = await makeProject(app, owner.cookie, "Shop");
    const shop = await makeConnection(app, admin.cookie, "Shop", [project]);
    const key = keyOf(owner.id, ["connections:manage"]);

    for (let attempt = 1; attempt <= 10; attempt++) {
      const res = await withKey(app, key, "PUT", credentialsOf(shop), {
        username: "ada",
        password: `guess-${attempt}`,
      });
      assert.equal(res.json().code, "PERSONAL_CREDENTIALS_REJECTED", `attempt ${attempt}: ${res.body}`);
    }
    const eleventh = await withKey(app, key, "PUT", credentialsOf(shop), { username: "ada", password: "guess-11" });
    assert.equal(eleventh.statusCode, 429, eleventh.body);
    assert.equal(verify.mock.callCount(), 10, "the eleventh was never tried on the database");
    // Reading is not what is limited.
    assert.equal((await withKey(app, key, "GET", credentialsOf(shop))).statusCode, 200);
  } finally {
    verify.mock.restore();
    closeAllRooms();
    await app.close();
  }
});
