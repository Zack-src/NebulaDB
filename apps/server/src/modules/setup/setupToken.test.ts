import { test, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

/** First-run setup when the operator set `NEBULADB_SETUP_TOKEN`: without the token, nobody claims the instance. */
await useTestDatabase("setuptoken");
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";
process.env.NEBULADB_SETUP_TOKEN = "  s3cret-setup-token  ";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");

const HOST = "localhost:3001";
const app = await buildApp();
void after(async () => {
  await closeAllRooms();
  await app.close();
});

let counter = 0;
function call(method: "GET" | "POST", url: string, payload?: object) {
  return app.inject({
    method,
    url,
    remoteAddress: `10.8.0.${++counter}`,
    headers: { host: HOST, origin: `http://${HOST}` },
    ...(payload === undefined ? {} : { payload }),
  });
}

const body = { email: "first@example.com", password: "correct horse battery staple", displayName: "First" };
const userCount = async () => ((await db.prepare("SELECT COUNT(*) AS n FROM users").get()) as { n: number }).n;

test("setup with a configured token", async (t) => {
  await t.test("status says a token is required, and nothing about it", async () => {
    const res = await call("GET", "/api/setup/status");
    assert.deepEqual(res.json(), { needsSetup: true, tokenRequired: true });
  });

  await t.test("a missing, empty or wrong token is refused", async () => {
    for (const token of [undefined, "", "s3cret-setup-toke", "s3cret-setup-token-", "  s3cret-setup-token  "]) {
      const res = await call("POST", "/api/setup", token === undefined ? body : { ...body, token });
      assert.equal(res.statusCode, 403, String(token));
      assert.equal(res.json().code, "SETUP_TOKEN_INVALID");
      assert.ok(!res.body.includes("s3cret"));
    }
    assert.equal(await userCount(), 0);
  });

  await t.test("the right token (the variable trimmed) creates the administrator", async () => {
    const res = await call("POST", "/api/setup", { ...body, token: "s3cret-setup-token" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().isAdmin, true);
    assert.equal(await userCount(), 1);
    const again = await call("POST", "/api/setup", {
      ...body,
      email: "second@example.com",
      token: "s3cret-setup-token",
    });
    assert.equal(again.statusCode, 409);
    assert.equal(again.json().code, "SETUP_ALREADY_DONE");
  });
});
