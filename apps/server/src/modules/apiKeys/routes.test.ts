import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Same rationale as `app.test.ts`: env vars must land before anything
// transitively imports `db.ts`/`shared/crypto.ts`.
process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-apikeys-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
process.env.ATHANORDB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");

const HOST = "localhost:3001";
const ORIGIN = `http://${HOST}`;

function headers(extra: Record<string, string> = {}) {
  return { host: HOST, origin: ORIGIN, ...extra };
}

async function loginAs(app: Awaited<ReturnType<typeof buildApp>>, email: string, password: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password },
  });
  const sessionCookie = res.cookies.find((c) => c.name === "athanordb_sid");
  return `athanordb_sid=${sessionCookie!.value}`;
}

async function makeUser() {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, 0, NULL)").run(
    id,
    email,
    await hashPassword(password),
  );
  return { id, email, password };
}

test("API key management: create, list (redacted), revoke, and ownership scoping", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const cookie = await loginAs(app, owner.email, owner.password);
    const other = await makeUser();
    const otherCookie = await loginAs(app, other.email, other.password);

    const created = await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: headers({ cookie }),
      payload: { name: "CI pipeline", scopes: ["projects:read", "projects:write"] },
    });
    assert.equal(created.statusCode, 201);
    const body = created.json();
    assert.match(body.plaintextKey, /^adb_/);
    assert.equal(body.summary.name, "CI pipeline");
    assert.deepEqual(body.summary.scopes, ["projects:read", "projects:write"]);

    const listed = await app.inject({ method: "GET", url: "/api/keys", headers: headers({ cookie }) });
    const keys = listed.json().keys;
    assert.equal(keys.length, 1);
    assert.equal(keys[0].id, body.summary.id);
    assert.equal("keyHash" in keys[0], false, "the hash must never be returned to the client");
    assert.equal("plaintextKey" in keys[0], false);

    // Another user's key list must not see this one.
    const otherList = await app.inject({ method: "GET", url: "/api/keys", headers: headers({ cookie: otherCookie }) });
    assert.equal(otherList.json().keys.length, 0);

    // Another user can't revoke this key either — scoped by owning user_id.
    const wrongRevoke = await app.inject({
      method: "DELETE",
      url: `/api/keys/${body.summary.id}`,
      headers: headers({ cookie: otherCookie }),
    });
    assert.equal(wrongRevoke.statusCode, 404);

    const revoke = await app.inject({
      method: "DELETE",
      url: `/api/keys/${body.summary.id}`,
      headers: headers({ cookie }),
    });
    assert.equal(revoke.statusCode, 200);
    assert.equal(revoke.json().revoked, true);

    // Revoking twice is a 404, not a silent success.
    const revokeAgain = await app.inject({
      method: "DELETE",
      url: `/api/keys/${body.summary.id}`,
      headers: headers({ cookie }),
    });
    assert.equal(revokeAgain.statusCode, 404);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("API key creation rejects a missing name, invalid scopes, or a project the caller can't see", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const cookie = await loginAs(app, owner.email, owner.password);
    const stranger = await makeUser();
    const strangerCookie = await loginAs(app, stranger.email, stranger.password);

    const noName = await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: headers({ cookie }),
      payload: { scopes: ["projects:read"] },
    });
    assert.equal(noName.statusCode, 400);
    assert.equal(noName.json().code, "API_KEY_NAME_REQUIRED");

    const badScopes = await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: headers({ cookie }),
      payload: { name: "bad", scopes: ["not-a-real-scope"] },
    });
    assert.equal(badScopes.statusCode, 400);
    assert.equal(badScopes.json().code, "API_KEY_SCOPES_INVALID");

    // A project id that doesn't exist at all is still rejected — a project
    // with no team assigned defaults to viewable by any logged-in user
    // (see `shared/permissions.test.ts`), so "a project the caller can't
    // see" only reliably means "doesn't exist" without also standing up a
    // team-restricted project here.
    const forbiddenProject = await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: headers({ cookie: strangerCookie }),
      payload: { name: "sneaky", scopes: ["projects:read"], projectId: randomUUID() },
    });
    assert.equal(forbiddenProject.statusCode, 404);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("API key management endpoints require a session — an API key itself cannot manage keys", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser();
    const cookie = await loginAs(app, owner.email, owner.password);

    const created = await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: headers({ cookie }),
      payload: { name: "escalation-test", scopes: ["projects:read"] },
    });
    const plaintextKey = created.json().plaintextKey;

    const res = await app.inject({
      method: "GET",
      url: "/api/keys",
      headers: headers({ authorization: `Bearer ${plaintextKey}` }),
    });
    // `req.user` does resolve via the key, but `requireSessionUser` refuses
    // any request that resolved through `req.apiKey` rather than a cookie —
    // this must be a real 401, not the key's own key list.
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().code, "AUTH_REQUIRED");
  } finally {
    closeAllRooms();
    await app.close();
  }
});
