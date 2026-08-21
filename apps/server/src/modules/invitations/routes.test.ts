import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Same rationale as `app.test.ts`: env vars must land before anything
// transitively imports `db.ts`.
process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-invitations-${randomUUID()}.sqlite`);
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

test("POST /api/invitations is admin-only, and creates a listable, revocable invite", async () => {
  const app = await buildApp();
  try {
    const plain = await makeUser(0);
    const admin = await makeUser(1);
    const plainCookie = await loginAs(app, plain.email, plain.password);
    const adminCookie = await loginAs(app, admin.email, admin.password);

    const forbidden = await app.inject({
      method: "POST",
      url: "/api/invitations",
      headers: headers({ cookie: plainCookie }),
      payload: { email: "new-hire@example.com" },
    });
    assert.equal(forbidden.statusCode, 403);

    const created = await app.inject({
      method: "POST",
      url: "/api/invitations",
      headers: headers({ cookie: adminCookie }),
      payload: { email: "New-Hire@Example.com" },
    });
    assert.equal(created.statusCode, 201);
    const { token, email } = created.json();
    assert.equal(email, "new-hire@example.com"); // normalized

    const listed = await app.inject({ method: "GET", url: "/api/invitations", headers: headers({ cookie: adminCookie }) });
    assert.equal(listed.statusCode, 200);
    const entry = (listed.json() as { token: string; status: string }[]).find((e) => e.token === token);
    assert.equal(entry?.status, "pending");

    const revoked = await app.inject({
      method: "DELETE",
      url: `/api/invitations/${token}`,
      headers: headers({ cookie: adminCookie }),
    });
    assert.equal(revoked.statusCode, 200);

    const accept = await app.inject({
      method: "POST",
      url: `/api/invitations/${token}/accept`,
      headers: headers(),
      payload: { password: "a perfectly fine password" },
    });
    assert.equal(accept.statusCode, 400);
    assert.equal(accept.json().code, "INVITATION_INVALID"); // revoked, not just expired
  } finally {
    await app.close();
  }
});

test("accepting an invitation creates a session and an account; a second accept of the same token fails", async () => {
  const app = await buildApp();
  try {
    const admin = await makeUser(1);
    const adminCookie = await loginAs(app, admin.email, admin.password);
    const created = await app.inject({
      method: "POST",
      url: "/api/invitations",
      headers: headers({ cookie: adminCookie }),
      payload: { email: `${randomUUID()}@example.com` },
    });
    const { token } = created.json();

    const accepted = await app.inject({
      method: "POST",
      url: `/api/invitations/${token}/accept`,
      headers: headers(),
      payload: { password: "a perfectly fine password" },
    });
    assert.equal(accepted.statusCode, 200);
    assert.ok(accepted.cookies.some((c) => c.name === "athanordb_sid"));

    // Sequential reuse: the invitation's status is already "accepted" by the
    // time this second call's own status check runs, so it's refused as an
    // invalid invitation, not as a use-once race — 409/ALREADY_USED is the
    // transaction-level check for two truly *simultaneous* accepts (see the
    // TOCTOU test below), not for one arriving after the other has finished.
    const secondAttempt = await app.inject({
      method: "POST",
      url: `/api/invitations/${token}/accept`,
      headers: headers(),
      payload: { password: "a different password entirely" },
    });
    assert.equal(secondAttempt.statusCode, 400);
    assert.equal(secondAttempt.json().code, "INVITATION_INVALID");
  } finally {
    await app.close();
  }
});

test("two truly simultaneous accepts of the same token: one wins, one gets ALREADY_USED, only one account is created", async () => {
  const app = await buildApp();
  try {
    const admin = await makeUser(1);
    const adminCookie = await loginAs(app, admin.email, admin.password);
    const created = await app.inject({
      method: "POST",
      url: "/api/invitations",
      headers: headers({ cookie: adminCookie }),
      payload: { email: `${randomUUID()}@example.com` },
    });
    const { token, email } = created.json();

    // Both requests pass the initial "is this pending?" check before either
    // commits — this is exactly the TOCTOU race `routes.ts`'s comment
    // describes, exercised for real instead of just trusting the comment.
    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/invitations/${token}/accept`,
        headers: headers(),
        payload: { password: "the first request's password" },
      }),
      app.inject({
        method: "POST",
        url: `/api/invitations/${token}/accept`,
        headers: headers(),
        payload: { password: "the second request's password" },
      }),
    ]);

    const codes = [first.statusCode, second.statusCode].sort();
    assert.deepEqual(codes, [200, 409]);
    const loser = first.statusCode === 409 ? first : second;
    assert.equal(loser.json().code, "INVITATION_ALREADY_USED");
    const count = db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = ?").get(email) as { n: number };
    assert.equal(count.n, 1);
  } finally {
    await app.close();
  }
});

test("accepting with a weak password is refused before the account is created", async () => {
  const app = await buildApp();
  try {
    const admin = await makeUser(1);
    const adminCookie = await loginAs(app, admin.email, admin.password);
    const created = await app.inject({
      method: "POST",
      url: "/api/invitations",
      headers: headers({ cookie: adminCookie }),
      payload: { email: `${randomUUID()}@example.com` },
    });
    const { token, email } = created.json();

    const weak = await app.inject({
      method: "POST",
      url: `/api/invitations/${token}/accept`,
      headers: headers(),
      payload: { password: "short" },
    });
    assert.equal(weak.statusCode, 400);
    assert.equal(weak.json().code, "PASSWORD_TOO_WEAK");
    assert.equal(db.prepare("SELECT 1 FROM users WHERE email = ?").get(email), undefined);
  } finally {
    await app.close();
  }
});
