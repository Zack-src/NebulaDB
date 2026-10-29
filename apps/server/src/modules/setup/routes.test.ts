import { test, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

/**
 * First-run setup on an instance with no account: who may create the first
 * administrator, that only one ever is, and that the route is closed for good
 * afterwards. No `NEBULADB_SETUP_TOKEN` here — `setupToken.test.ts` covers it.
 */
const databaseUrl = await useTestDatabase("setup");
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";
delete process.env.NEBULADB_SETUP_TOKEN;

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { createApiKey } = await import("../apiKeys/repository.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");

const HOST = "localhost:3001";
const PASSWORD = "correct horse battery staple";
const app = await buildApp();
void after(async () => {
  await closeAllRooms();
  await app.close();
});

let counter = 0;
/** Each call from its own address, so the per-IP rate limit does not decide the outcome. */
const address = () => `10.7.${Math.floor(counter / 250) % 250}.${(counter++ % 250) + 1}`;

function call(method: "GET" | "POST", url: string, payload?: object, extra: Record<string, string> = {}) {
  return app.inject({
    method,
    url,
    remoteAddress: address(),
    headers: { host: HOST, origin: `http://${HOST}`, ...extra },
    ...(payload === undefined ? {} : { payload }),
  });
}

const userCount = async () => ((await db.prepare("SELECT COUNT(*) AS n FROM users").get()) as { n: number }).n;

test("first-run setup", async (t) => {
  await t.test("a fresh instance needs setup, without a token", async () => {
    assert.equal(await userCount(), 0);
    const res = await call("GET", "/api/setup/status");
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { needsSetup: true, tokenRequired: false });
  });

  await t.test("a weak password, a bad email or no display name is refused and creates nothing", async () => {
    const weak = await call("POST", "/api/setup", { email: "a@example.com", password: "password", displayName: "A" });
    assert.equal(weak.statusCode, 400);
    assert.equal(weak.json().code, "PASSWORD_TOO_WEAK");
    const short = await call("POST", "/api/setup", { email: "a@example.com", password: "short", displayName: "A" });
    assert.equal(short.json().code, "PASSWORD_TOO_WEAK");
    const email = await call("POST", "/api/setup", { email: "nope", password: PASSWORD, displayName: "A" });
    assert.equal(email.json().code, "EMAIL_INVALID");
    const name = await call("POST", "/api/setup", { email: "a@example.com", password: PASSWORD, displayName: "  " });
    assert.equal(name.json().code, "DISPLAY_NAME_REQUIRED");
    const shape = await call("POST", "/api/setup", { email: 5, password: {}, displayName: [] });
    assert.equal(shape.statusCode, 400);
    assert.equal(await userCount(), 0);
  });

  let cookie = "";
  await t.test("concurrent setups create exactly one administrator", async () => {
    // Left alone, the requests are spread out by their password hashing and rarely meet. So another
    // connection holds the `users` table while they arrive: all of them get past the first "no account
    // yet" check and pile up at the critical section, then are let go together. Without the route's own
    // lock they would all insert.
    const N = 8;
    const blocker = new pg.Client({ connectionString: databaseUrl });
    await blocker.connect();
    let attempts;
    try {
      await blocker.query("BEGIN");
      await blocker.query("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE");
      const pending = Promise.all(
        Array.from({ length: N }, (_, i) =>
          call("POST", "/api/setup", { email: `admin${i}@example.com`, password: PASSWORD, displayName: `Admin ${i}` }),
        ),
      );
      const deadline = Date.now() + 15_000;
      for (;;) {
        // Inside a transaction, pg_stat_activity is a snapshot taken on first read: drop it each time.
        await blocker.query("SELECT pg_stat_clear_snapshot()");
        const { rows } = await blocker.query(
          "SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
        );
        if ((rows[0] as { n: number }).n >= N) break;
        if (Date.now() > deadline) throw new Error(`only ${(rows[0] as { n: number }).n} requests reached the lock`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await blocker.query("COMMIT");
      attempts = await pending;
    } finally {
      await blocker.end();
    }
    const ok = attempts.filter((r) => r.statusCode === 200);
    assert.equal(ok.length, 1, attempts.map((r) => `${r.statusCode} ${r.body}`).join("\n"));
    for (const refused of attempts.filter((r) => r.statusCode !== 200)) {
      assert.equal(refused.statusCode, 409);
      assert.equal(refused.json().code, "SETUP_ALREADY_DONE");
    }
    assert.equal(await userCount(), 1);
    const admin = (await db.prepare("SELECT email, is_admin, display_name FROM users").get()) as {
      email: string;
      is_admin: number;
      display_name: string;
    };
    assert.equal(admin.is_admin, 1);
    assert.deepEqual(ok[0].json(), {
      id: ok[0].json().id,
      email: admin.email,
      isAdmin: true,
      displayName: admin.display_name,
    });
    const sid = ok[0].cookies.find((c) => c.name === "nebuladb_sid");
    assert.ok(sid, "the new administrator is signed in");
    cookie = `nebuladb_sid=${sid.value}`;
  });

  await t.test("the new administrator's session works, and the setup is in the audit log", async () => {
    const me = await call("GET", "/api/auth/me", undefined, { cookie });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().isAdmin, true);
    const rows = (await db.prepare("SELECT actor_email FROM audit_log WHERE action = 'setup.completed'").all()) as {
      actor_email: string;
    }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actor_email, me.json().email);
  });

  await t.test("once set up, status says so and every further setup is refused", async () => {
    assert.deepEqual((await call("GET", "/api/setup/status")).json(), { needsSetup: false, tokenRequired: false });
    const again = await call("POST", "/api/setup", {
      email: "late@example.com",
      password: PASSWORD,
      displayName: "Late",
    });
    assert.equal(again.statusCode, 409);
    assert.equal(again.json().code, "SETUP_ALREADY_DONE");
    // Even signed in as the administrator, and even with an empty body: the answer is the same and leaks nothing.
    const asAdmin = await call("POST", "/api/setup", {}, { cookie });
    assert.equal(asAdmin.statusCode, 409);
    assert.deepEqual(Object.keys(asAdmin.json()).sort(), Object.keys(again.json()).sort());
    assert.equal(await userCount(), 1);
  });

  await t.test("an API key is not a credential here", async () => {
    const admin = (await db.prepare("SELECT id FROM users").get()) as { id: string };
    const key = await createApiKey(admin.id, "setup", ["projects:read", "projects:write"] as never, null);
    const res = await call(
      "POST",
      "/api/setup",
      { email: "key@example.com", password: PASSWORD, displayName: "Key" },
      { authorization: `Bearer ${key.plaintextKey}` },
    );
    assert.equal(res.statusCode, 409);
    // The key did not authenticate the request either (keys only work under /api/v1).
    const me = await call("GET", "/api/auth/me", undefined, { authorization: `Bearer ${key.plaintextKey}` });
    assert.equal(me.statusCode, 401);
    assert.equal(await userCount(), 1);
  });
});
