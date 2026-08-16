import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Same rationale as `app.test.ts`: env vars must land before anything
// transitively imports `db.ts`/`shared/crypto.ts`.
process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-totp-routes-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
process.env.ATHANORDB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("./password.js");
const { totp } = await import("./totp.js");

const HOST = "localhost:3001";
const ORIGIN = `http://${HOST}`;

function headers(extra: Record<string, string> = {}) {
  return { host: HOST, origin: ORIGIN, ...extra };
}

async function makeUser(app: Awaited<ReturnType<typeof buildApp>>) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, 0, NULL)").run(
    id,
    email,
    await hashPassword(password),
  );
  const loginRes = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password },
  });
  const sessionCookie = loginRes.cookies.find((c) => c.name === "athanordb_sid");
  return { id, email, password, cookie: `athanordb_sid=${sessionCookie!.value}` };
}

/** Enrolls 2FA for an already-logged-in user, returning the secret and issued backup codes. */
async function enrollTotp(app: Awaited<ReturnType<typeof buildApp>>, cookie: string) {
  const setup = await app.inject({
    method: "POST",
    url: "/api/auth/totp/setup",
    headers: headers({ cookie }),
    payload: {},
  });
  assert.equal(setup.statusCode, 200);
  const { secret } = setup.json();

  const confirm = await app.inject({
    method: "POST",
    url: "/api/auth/totp/confirm",
    headers: headers({ cookie }),
    payload: { code: totp(secret) },
  });
  assert.equal(confirm.statusCode, 200);
  const body = confirm.json();
  assert.equal(body.enabled, true);
  assert.equal(body.backupCodes.length, 10);
  return { secret, backupCodes: body.backupCodes as string[] };
}

test("totp/setup and /confirm require auth, and confirm rejects a wrong code", async () => {
  const app = await buildApp();
  try {
    const noAuth = await app.inject({ method: "POST", url: "/api/auth/totp/setup", headers: headers() });
    assert.equal(noAuth.statusCode, 401);

    const user = await makeUser(app);
    const setup = await app.inject({
      method: "POST",
      url: "/api/auth/totp/setup",
      headers: headers({ cookie: user.cookie }),
    });
    assert.equal(setup.statusCode, 200);
    const body = setup.json();
    assert.ok(body.secret);
    assert.ok(body.otpauthUrl.startsWith("otpauth://totp/"));

    const wrongCode = await app.inject({
      method: "POST",
      url: "/api/auth/totp/confirm",
      headers: headers({ cookie: user.cookie }),
      payload: { code: "000000" },
    });
    assert.equal(wrongCode.statusCode, 401);
    assert.equal(wrongCode.json().code, "TOTP_CODE_INCORRECT");

    const status = await app.inject({
      method: "GET",
      url: "/api/auth/totp/status",
      headers: headers({ cookie: user.cookie }),
    });
    assert.equal(status.json().enabled, false, "a rejected confirm must not have enabled 2FA");
  } finally {
    await app.close();
  }
});

test("full lifecycle: enable 2FA, login now requires it, a valid code completes login, a backup code works once", async () => {
  const app = await buildApp();
  try {
    const user = await makeUser(app);
    const { secret, backupCodes } = await enrollTotp(app, user.cookie);

    const statusAfter = await app.inject({
      method: "GET",
      url: "/api/auth/totp/status",
      headers: headers({ cookie: user.cookie }),
    });
    assert.deepEqual(statusAfter.json(), { enabled: true, backupCodesRemaining: 10 });

    // A fresh login no longer returns a session directly.
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: headers(),
      payload: { email: user.email, password: user.password },
    });
    assert.equal(login.statusCode, 200);
    const loginBody = login.json();
    assert.equal(loginBody.mfaRequired, true);
    assert.ok(loginBody.mfaToken);
    assert.equal(login.cookies.length, 0, "no session cookie until the second factor is verified");

    // Wrong code.
    const wrongTotp = await app.inject({
      method: "POST",
      url: "/api/auth/login/totp",
      headers: headers(),
      payload: { mfaToken: loginBody.mfaToken, code: "000000" },
    });
    assert.equal(wrongTotp.statusCode, 401);
    assert.equal(wrongTotp.json().code, "TOTP_CODE_INCORRECT");

    // Correct code finishes login.
    const rightTotp = await app.inject({
      method: "POST",
      url: "/api/auth/login/totp",
      headers: headers(),
      payload: { mfaToken: loginBody.mfaToken, code: totp(secret) },
    });
    assert.equal(rightTotp.statusCode, 200);
    const sessionCookie = rightTotp.cookies.find((c) => c.name === "athanordb_sid");
    assert.ok(sessionCookie);

    const me = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: headers({ cookie: `athanordb_sid=${sessionCookie!.value}` }),
    });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().id, user.id);

    // The challenge is single-use — replaying it must fail even with the right code.
    const replay = await app.inject({
      method: "POST",
      url: "/api/auth/login/totp",
      headers: headers(),
      payload: { mfaToken: loginBody.mfaToken, code: totp(secret) },
    });
    assert.equal(replay.statusCode, 401);
    assert.equal(replay.json().code, "MFA_CHALLENGE_INVALID");

    // A backup code logs in when the authenticator isn't available.
    const secondLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: headers(),
      payload: { email: user.email, password: user.password },
    });
    const backupAttempt = await app.inject({
      method: "POST",
      url: "/api/auth/login/totp",
      headers: headers(),
      payload: { mfaToken: secondLogin.json().mfaToken, code: backupCodes[0] },
    });
    assert.equal(backupAttempt.statusCode, 200);

    // That backup code is now spent — a fresh challenge must reject it.
    const thirdLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: headers(),
      payload: { email: user.email, password: user.password },
    });
    const reusedBackup = await app.inject({
      method: "POST",
      url: "/api/auth/login/totp",
      headers: headers(),
      payload: { mfaToken: thirdLogin.json().mfaToken, code: backupCodes[0] },
    });
    assert.equal(reusedBackup.statusCode, 401);

    const statusFinal = await app.inject({
      method: "GET",
      url: "/api/auth/totp/status",
      headers: headers({ cookie: user.cookie }),
    });
    assert.equal(statusFinal.json().backupCodesRemaining, 9);
  } finally {
    await app.close();
  }
});

test("login/totp rejects a missing or unknown mfaToken", async () => {
  const app = await buildApp();
  try {
    const missing = await app.inject({
      method: "POST",
      url: "/api/auth/login/totp",
      headers: headers(),
      payload: { code: "123456" },
    });
    assert.equal(missing.statusCode, 400);
    assert.equal(missing.json().code, "MFA_TOKEN_REQUIRED");

    const unknown = await app.inject({
      method: "POST",
      url: "/api/auth/login/totp",
      headers: headers(),
      payload: { mfaToken: randomUUID(), code: "123456" },
    });
    assert.equal(unknown.statusCode, 401);
    assert.equal(unknown.json().code, "MFA_CHALLENGE_INVALID");
  } finally {
    await app.close();
  }
});

test("disabling 2FA requires both the password and a valid code, and really turns it off", async () => {
  const app = await buildApp();
  try {
    const user = await makeUser(app);
    const { secret } = await enrollTotp(app, user.cookie);

    const wrongPassword = await app.inject({
      method: "POST",
      url: "/api/auth/totp/disable",
      headers: headers({ cookie: user.cookie }),
      payload: { password: "not it", code: totp(secret) },
    });
    assert.equal(wrongPassword.statusCode, 401);
    assert.equal(wrongPassword.json().code, "PASSWORD_INCORRECT");

    const wrongCode = await app.inject({
      method: "POST",
      url: "/api/auth/totp/disable",
      headers: headers({ cookie: user.cookie }),
      payload: { password: user.password, code: "000000" },
    });
    assert.equal(wrongCode.statusCode, 401);
    assert.equal(wrongCode.json().code, "TOTP_CODE_INCORRECT");

    const ok = await app.inject({
      method: "POST",
      url: "/api/auth/totp/disable",
      headers: headers({ cookie: user.cookie }),
      payload: { password: user.password, code: totp(secret) },
    });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().enabled, false);

    // A login now succeeds directly again, no second step.
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: headers(),
      payload: { email: user.email, password: user.password },
    });
    assert.equal(login.statusCode, 200);
    assert.equal(login.json().mfaRequired, undefined);
  } finally {
    await app.close();
  }
});

test("regenerate-backup-codes invalidates the old set and requires the password", async () => {
  const app = await buildApp();
  try {
    const user = await makeUser(app);
    const { backupCodes: original } = await enrollTotp(app, user.cookie);

    const noPassword = await app.inject({
      method: "POST",
      url: "/api/auth/totp/regenerate-backup-codes",
      headers: headers({ cookie: user.cookie }),
      payload: {},
    });
    assert.equal(noPassword.statusCode, 400);

    const regen = await app.inject({
      method: "POST",
      url: "/api/auth/totp/regenerate-backup-codes",
      headers: headers({ cookie: user.cookie }),
      payload: { password: user.password },
    });
    assert.equal(regen.statusCode, 200);
    const fresh = regen.json().backupCodes as string[];
    assert.equal(fresh.length, 10);
    const overlap = fresh.filter((code) => original.includes(code));
    assert.equal(overlap.length, 0, "regenerated codes must not overlap the old set");
  } finally {
    await app.close();
  }
});
