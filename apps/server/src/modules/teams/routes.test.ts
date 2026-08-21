import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-teams-${randomUUID()}.sqlite`);
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

test("GET /api/teams is any authenticated user; write routes are admin-only", async () => {
  const app = await buildApp();
  try {
    const plain = await makeUser(0);
    const admin = await makeUser(1);
    const plainCookie = await loginAs(app, plain.email, plain.password);
    const adminCookie = await loginAs(app, admin.email, admin.password);

    const unauth = await app.inject({ method: "GET", url: "/api/teams", headers: headers() });
    assert.equal(unauth.statusCode, 401);

    const asPlain = await app.inject({ method: "GET", url: "/api/teams", headers: headers({ cookie: plainCookie }) });
    assert.equal(asPlain.statusCode, 200);
    assert.ok(Array.isArray(asPlain.json()));

    const createForbidden = await app.inject({
      method: "POST",
      url: "/api/teams",
      headers: headers({ cookie: plainCookie }),
      payload: { name: "Engineering" },
    });
    assert.equal(createForbidden.statusCode, 403);

    const created = await app.inject({
      method: "POST",
      url: "/api/teams",
      headers: headers({ cookie: adminCookie }),
      payload: { name: "Engineering" },
    });
    assert.equal(created.statusCode, 201);
    const team = created.json();
    assert.equal(team.memberCount, 0);
  } finally {
    await app.close();
  }
});

test("team lifecycle: create, add/remove a member, rename, delete — each step visible through GET /api/teams/:id", async () => {
  const app = await buildApp();
  try {
    const admin = await makeUser(1);
    const member = await makeUser(0);
    const adminCookie = await loginAs(app, admin.email, admin.password);

    const created = await app.inject({
      method: "POST",
      url: "/api/teams",
      headers: headers({ cookie: adminCookie }),
      payload: { name: "Design" },
    });
    const { id } = created.json();

    const missingUser = await app.inject({
      method: "POST",
      url: `/api/teams/${id}/members`,
      headers: headers({ cookie: adminCookie }),
      payload: { userId: randomUUID() },
    });
    assert.equal(missingUser.statusCode, 400);
    assert.equal(missingUser.json().code, "USER_ID_INVALID");

    const added = await app.inject({
      method: "POST",
      url: `/api/teams/${id}/members`,
      headers: headers({ cookie: adminCookie }),
      payload: { userId: member.id },
    });
    assert.equal(added.statusCode, 200);

    const withMember = await app.inject({ method: "GET", url: `/api/teams/${id}`, headers: headers({ cookie: adminCookie }) });
    assert.equal(withMember.json().members.length, 1);
    assert.equal(withMember.json().members[0].email, member.email);

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/teams/${id}/members/${member.id}`,
      headers: headers({ cookie: adminCookie }),
    });
    assert.equal(removed.statusCode, 200);

    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/teams/${id}`,
      headers: headers({ cookie: adminCookie }),
      payload: { name: "Design & UX" },
    });
    assert.equal(renamed.statusCode, 200);
    assert.equal(renamed.json().name, "Design & UX");

    const deleted = await app.inject({ method: "DELETE", url: `/api/teams/${id}`, headers: headers({ cookie: adminCookie }) });
    assert.equal(deleted.statusCode, 200);

    const goneAfterDelete = await app.inject({ method: "GET", url: `/api/teams/${id}`, headers: headers({ cookie: adminCookie }) });
    assert.equal(goneAfterDelete.statusCode, 404);
  } finally {
    await app.close();
  }
});

test("an empty or over-long team name is rejected", async () => {
  const app = await buildApp();
  try {
    const admin = await makeUser(1);
    const adminCookie = await loginAs(app, admin.email, admin.password);

    const empty = await app.inject({
      method: "POST",
      url: "/api/teams",
      headers: headers({ cookie: adminCookie }),
      payload: { name: "   " },
    });
    assert.equal(empty.statusCode, 400);
    assert.equal(empty.json().code, "NAME_REQUIRED");

    const tooLong = await app.inject({
      method: "POST",
      url: "/api/teams",
      headers: headers({ cookie: adminCookie }),
      payload: { name: "x".repeat(201) },
    });
    assert.equal(tooLong.statusCode, 400);
    assert.equal(tooLong.json().code, "NAME_TOO_LONG");
  } finally {
    await app.close();
  }
});
