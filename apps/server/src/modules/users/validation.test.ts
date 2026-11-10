import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

await useTestDatabase("validation_users");
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");

const HOST = "localhost:3001";
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `http://${HOST}`, ...extra });

test("malformed input is a 400 VALIDATION_FAILED on users, API keys and audit", async () => {
  const app = await buildApp();
  try {
    const password = "correct horse battery staple";
    const email = `${randomUUID()}@example.com`;
    await db
      .prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, 1, NULL)")
      .run(randomUUID(), email, await hashPassword(password));
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: headers(),
      payload: { email, password },
    });
    const cookie = `nebuladb_sid=${login.cookies.find((c) => c.name === "nebuladb_sid")!.value}`;

    const send = (method: "POST" | "PATCH" | "GET", url: string, payload?: unknown) =>
      app.inject({
        method,
        url,
        headers: headers({ cookie }),
        ...(payload === undefined ? {} : { payload: payload as object }),
      });

    const name = await send("PATCH", "/api/users/me", { displayName: 42 });
    assert.equal(name.statusCode, 400);
    assert.equal(name.json().code, "VALIDATION_FAILED");
    assert.equal(name.json().fields[0].path, "displayName");

    // Fields with their own error code keep it.
    const empty = await send("PATCH", "/api/users/me", {});
    assert.equal(empty.json().code, "DISPLAY_NAME_REQUIRED");

    const key = await send("POST", "/api/keys", { name: ["x"], scopes: ["read"] });
    assert.equal(key.statusCode, 400);
    assert.equal(key.json().code, "VALIDATION_FAILED");
    const badScopes = await send("POST", "/api/keys", { name: "k", scopes: "read" });
    assert.equal(badScopes.json().code, "API_KEY_SCOPES_INVALID");

    const audit = await send("GET", "/api/audit?limit=1&limit=2");
    assert.equal(audit.statusCode, 400);
    assert.equal(audit.json().code, "VALIDATION_FAILED");

    const other = await send("PATCH", `/api/users/${randomUUID()}/disabled`, { disabled: true });
    assert.equal(other.statusCode, 404);
  } finally {
    await app.close();
  }
});
