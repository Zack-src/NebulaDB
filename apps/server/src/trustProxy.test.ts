import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { useTestDatabase } from "./infrastructure/testDatabase.js";

// `config` is read once at import: the proxy setting has to be in the
// environment before `app.js` (and so `config.js`) is first imported.
await useTestDatabase("trust_proxy");
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_LOG_LEVEL = "silent";
process.env.NEBULADB_TRUST_PROXY = "1";

const { parseTrustProxy } = await import("./config.js");
const { buildApp } = await import("./app.js");

const HOST = "localhost:3001";

test("parseTrustProxy: off by default, booleans, hop counts and address lists", () => {
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy(""), false);
  assert.equal(parseTrustProxy("false"), false);
  assert.equal(parseTrustProxy("true"), true);
  assert.equal(parseTrustProxy("1"), 1);
  assert.equal(parseTrustProxy(" 2 "), 2);
  assert.deepEqual(parseTrustProxy("127.0.0.1, 10.0.0.0/8,::1,fd00::/8"), ["127.0.0.1", "10.0.0.0/8", "::1", "fd00::/8"]);
});

test("parseTrustProxy: rejects anything else", () => {
  for (const bad of ["0", "101", "yes", "nginx", "10.0.0.0/33", "::1/129", "10.0.0.1/8/2", "10.0.0.0/x", "1.2.3"]) {
    assert.throws(() => parseTrustProxy(bad), Error, `accepted ${JSON.stringify(bad)}`);
  }
});

test("behind a trusted proxy, the login limit is per client (X-Forwarded-For), not per proxy", async () => {
  const app = await buildApp();
  try {
    const attempt = (ip: string) =>
      app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { host: HOST, origin: `http://${HOST}`, "x-forwarded-for": ip },
        payload: { email: `${randomUUID()}@example.com`, password: "definitely wrong" },
      });

    let limited = false;
    for (let i = 0; i < 12 && !limited; i++) limited = (await attempt("203.0.113.7")).statusCode === 429;
    assert.ok(limited, "one client never hit the 10/minute login limit");

    // Same proxy (the injected requests all come from 127.0.0.1), other client.
    const other = await attempt("198.51.100.23");
    assert.equal(other.statusCode, 401);
  } finally {
    await app.close();
  }
});
