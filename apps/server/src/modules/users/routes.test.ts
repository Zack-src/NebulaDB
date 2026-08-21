import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-users-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
process.env.ATHANORDB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");

const HOST = "localhost:3001";
const ORIGIN = `http://${HOST}`;

function headers(extra: Record<string, string> = {}) {
  return { host: HOST, origin: ORIGIN, ...extra };
}

async function loginAs(app: Awaited<ReturnType<typeof buildApp>>, email: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", headers: headers(), payload: { email, password } });
  const sessionCookie = res.cookies.find((c) => c.name === "athanordb_sid");
  return `athanordb_sid=${sessionCookie!.value}`;
}

async function makeUser(isAdmin: 0 | 1 = 0) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?, NULL)").run(
    id,
    email,
    await hashPassword(password),
    isAdmin,
  );
  return { id, email, password };
}

// --- self-service (account.ts) ---

test("PATCH /api/users/me changes the caller's own display name", async () => {
  const app = await buildApp();
  try {
    const user = await makeUser();
    const cookie = await loginAs(app, user.email, user.password);

    const unauth = await app.inject({ method: "PATCH", url: "/api/users/me", headers: headers(), payload: { displayName: "X" } });
    assert.equal(unauth.statusCode, 401);

    const missing = await app.inject({
      method: "PATCH",
      url: "/api/users/me",
      headers: headers({ cookie }),
      payload: { displayName: "   " },
    });
    assert.equal(missing.statusCode, 400);
    assert.equal(missing.json().code, "DISPLAY_NAME_REQUIRED");

    const ok = await app.inject({
      method: "PATCH",
      url: "/api/users/me",
      headers: headers({ cookie }),
      payload: { displayName: "Ada Lovelace" },
    });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().displayName, "Ada Lovelace");
  } finally {
    await app.close();
  }
});

test("PATCH /api/users/me/password requires the correct current password and a strong new one", async () => {
  const app = await buildApp();
  try {
    const user = await makeUser();
    const cookie = await loginAs(app, user.email, user.password);

    const wrongCurrent = await app.inject({
      method: "PATCH",
      url: "/api/users/me/password",
      headers: headers({ cookie }),
      payload: { currentPassword: "not it", newPassword: "a perfectly fine new password" },
    });
    assert.equal(wrongCurrent.statusCode, 401);
    assert.equal(wrongCurrent.json().code, "CURRENT_PASSWORD_INCORRECT");

    const weakNew = await app.inject({
      method: "PATCH",
      url: "/api/users/me/password",
      headers: headers({ cookie }),
      payload: { currentPassword: user.password, newPassword: "short" },
    });
    assert.equal(weakNew.statusCode, 400);
    assert.equal(weakNew.json().code, "PASSWORD_TOO_WEAK");

    const ok = await app.inject({
      method: "PATCH",
      url: "/api/users/me/password",
      headers: headers({ cookie }),
      payload: { currentPassword: user.password, newPassword: "a perfectly fine new password" },
    });
    assert.equal(ok.statusCode, 200);

    // The old password no longer works.
    const oldLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: headers(),
      payload: { email: user.email, password: user.password },
    });
    assert.equal(oldLogin.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("GET /api/users/me/export returns a downloadable JSON export", async () => {
  const app = await buildApp();
  try {
    const user = await makeUser();
    const cookie = await loginAs(app, user.email, user.password);
    const res = await app.inject({ method: "GET", url: "/api/users/me/export", headers: headers({ cookie }) });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-disposition"] as string, /attachment/);
    const body = res.json();
    assert.equal(body.account.email, user.email);
  } finally {
    await app.close();
  }
});

test("DELETE /api/users/me requires the password, and refuses to remove the last active admin", async () => {
  const app = await buildApp();
  try {
    const soleAdmin = await makeUser(1);
    const adminCookie = await loginAs(app, soleAdmin.email, soleAdmin.password);

    const noPassword = await app.inject({ method: "DELETE", url: "/api/users/me", headers: headers({ cookie: adminCookie }) });
    assert.equal(noPassword.statusCode, 400);
    assert.equal(noPassword.json().code, "PASSWORD_REQUIRED_FOR_DELETION");

    const asLastAdmin = await app.inject({
      method: "DELETE",
      url: "/api/users/me",
      headers: headers({ cookie: adminCookie }),
      payload: { password: soleAdmin.password },
    });
    assert.equal(asLastAdmin.statusCode, 400);
    assert.equal(asLastAdmin.json().code, "LAST_ADMIN_SELF");

    // A second admin exists now, so the first can delete themselves.
    await makeUser(1);
    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/users/me",
      headers: headers({ cookie: adminCookie }),
      payload: { password: soleAdmin.password },
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal(deleted.json().deleted, true);
  } finally {
    await app.close();
  }
});

// --- admin (admin.ts) ---

test("GET /api/users and PATCH /api/users/:id/password are admin-only", async () => {
  const app = await buildApp();
  try {
    const plain = await makeUser(0);
    const admin = await makeUser(1);
    const plainCookie = await loginAs(app, plain.email, plain.password);
    const adminCookie = await loginAs(app, admin.email, admin.password);

    const forbiddenList = await app.inject({ method: "GET", url: "/api/users", headers: headers({ cookie: plainCookie }) });
    assert.equal(forbiddenList.statusCode, 403);

    const list = await app.inject({ method: "GET", url: "/api/users", headers: headers({ cookie: adminCookie }) });
    assert.equal(list.statusCode, 200);
    assert.ok((list.json() as { id: string }[]).some((u) => u.id === plain.id));

    const reset = await app.inject({
      method: "PATCH",
      url: `/api/users/${plain.id}/password`,
      headers: headers({ cookie: adminCookie }),
      payload: { newPassword: "an admin chose this new password" },
    });
    assert.equal(reset.statusCode, 200);

    // The plain user's session is killed by the reset.
    const revokedSession = await app.inject({ method: "GET", url: "/api/users/me/export", headers: headers({ cookie: plainCookie }) });
    assert.equal(revokedSession.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("PATCH /api/users/:id/disabled refuses self-disable and disabling the last admin", async () => {
  const app = await buildApp();
  try {
    const soleAdmin = await makeUser(1);
    const plain = await makeUser(0);
    const adminCookie = await loginAs(app, soleAdmin.email, soleAdmin.password);

    const selfDisable = await app.inject({
      method: "PATCH",
      url: `/api/users/${soleAdmin.id}/disabled`,
      headers: headers({ cookie: adminCookie }),
      payload: { disabled: true },
    });
    assert.equal(selfDisable.statusCode, 400);
    assert.equal(selfDisable.json().code, "CANNOT_DISABLE_SELF");

    const disabled = await app.inject({
      method: "PATCH",
      url: `/api/users/${plain.id}/disabled`,
      headers: headers({ cookie: adminCookie }),
      payload: { disabled: true },
    });
    assert.equal(disabled.statusCode, 200);

    const loginWhileDisabled = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: headers(),
      payload: { email: plain.email, password: plain.password },
    });
    assert.equal(loginWhileDisabled.statusCode, 403);
    assert.equal(loginWhileDisabled.json().code, "ACCOUNT_DISABLED");

    const reenabled = await app.inject({
      method: "PATCH",
      url: `/api/users/${plain.id}/disabled`,
      headers: headers({ cookie: adminCookie }),
      payload: { disabled: false },
    });
    assert.equal(reenabled.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("DELETE /api/users/:id refuses self-delete, refuses removing the last admin, and honours transferProjectsTo", async () => {
  const app = await buildApp();
  try {
    const soleAdmin = await makeUser(1);
    const target = await makeUser(0);
    const heir = await makeUser(0);
    const adminCookie = await loginAs(app, soleAdmin.email, soleAdmin.password);

    const selfDelete = await app.inject({
      method: "DELETE",
      url: `/api/users/${soleAdmin.id}`,
      headers: headers({ cookie: adminCookie }),
    });
    assert.equal(selfDelete.statusCode, 400);
    assert.equal(selfDelete.json().code, "CANNOT_DELETE_SELF");

    const invalidTransfer = await app.inject({
      method: "DELETE",
      url: `/api/users/${target.id}`,
      headers: headers({ cookie: adminCookie }),
      payload: { transferProjectsTo: randomUUID() },
    });
    assert.equal(invalidTransfer.statusCode, 400);
    assert.equal(invalidTransfer.json().code, "TRANSFER_TARGET_INVALID");

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/users/${target.id}`,
      headers: headers({ cookie: adminCookie }),
      payload: { transferProjectsTo: heir.id },
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal(deleted.json().transferred, true);
    assert.equal(db.prepare("SELECT 1 FROM users WHERE id = ?").get(target.id), undefined);
  } finally {
    await app.close();
  }
});
