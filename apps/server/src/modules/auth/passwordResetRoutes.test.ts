import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SMTPServer } from "smtp-server";

/**
 * Email flows against a real SMTP server — an in-process `smtp-server`
 * listening on TCP, so nodemailer goes through a genuine SMTP conversation
 * (greeting, auth, MAIL FROM, DATA) rather than a stub transport. What lands
 * in `inbox` is the raw message a real mail server would have received.
 */

interface ReceivedMail {
  to: string[];
  raw: string;
}
const inbox: ReceivedMail[] = [];
const smtp = new SMTPServer({
  authOptional: false,
  disabledCommands: ["STARTTLS"],
  onAuth(auth, _session, callback) {
    if (auth.username === "mailer" && auth.password === "smtp-secret") return callback(null, { user: "mailer" });
    return callback(new Error("bad credentials"));
  },
  onData(stream, session, callback) {
    let raw = "";
    stream.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
    stream.on("end", () => {
      inbox.push({ to: session.envelope.rcptTo.map((r) => r.address), raw });
      callback();
    });
  },
});
await new Promise<void>((resolve) => smtp.listen(0, "127.0.0.1", resolve));
const smtpPort = (smtp.server.address() as AddressInfo).port;
after(() => new Promise<void>((resolve) => smtp.close(() => resolve())));

process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-reset-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
process.env.ATHANORDB_LOG_LEVEL = "silent";
process.env.ATHANORDB_PUBLIC_URL = "https://schemas.example.test/";
process.env.ATHANORDB_SMTP_HOST = "127.0.0.1";
process.env.ATHANORDB_SMTP_PORT = String(smtpPort);
process.env.ATHANORDB_SMTP_SECURE = "false";
process.env.ATHANORDB_SMTP_USER = "mailer";
process.env.ATHANORDB_SMTP_PASSWORD = "smtp-secret";
process.env.ATHANORDB_SMTP_FROM = "AthanorDB <noreply@example.test>";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("./password.js");

const HOST = "localhost:3001";
const ORIGIN = `http://${HOST}`;
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: ORIGIN, ...extra });

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

/** Undoes quoted-printable soft breaks/escapes, so a link split across lines by the encoder can be matched whole. */
function decodeQuotedPrintable(raw: string): string {
  return raw
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

async function waitForMail(to: string): Promise<string> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const mail = inbox.find((m) => m.to.includes(to));
    if (mail) return decodeQuotedPrintable(mail.raw);
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`no email reached ${to}`);
}

test("forgot password: generic answer, a real email with an absolute link, single use, sessions killed", async () => {
  const app = await buildApp();
  try {
    const features = await app.inject({ method: "GET", url: "/api/auth/features", headers: headers() });
    assert.deepEqual(features.json(), { passwordReset: true });

    const user = await makeUser();
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: headers(),
      payload: { email: user.email, password: user.password },
    });
    const oldCookie = `athanordb_sid=${login.cookies.find((c) => c.name === "athanordb_sid")!.value}`;

    // Unknown address: same answer, nothing sent.
    const unknown = await app.inject({
      method: "POST",
      url: "/api/auth/password-reset/request",
      headers: headers(),
      payload: { email: "nobody-here@example.com" },
    });
    assert.equal(unknown.statusCode, 200);
    assert.deepEqual(unknown.json(), { requested: true });

    const requested = await app.inject({
      method: "POST",
      url: "/api/auth/password-reset/request",
      headers: headers(),
      payload: { email: user.email.toUpperCase() },
    });
    assert.deepEqual(requested.json(), unknown.json(), "response must not reveal whether the account exists");

    const mail = await waitForMail(user.email);
    assert.equal(inbox.filter((m) => m.to.includes("nobody-here@example.com")).length, 0);
    assert.match(mail, /Subject: =\?UTF-8\?|Subject: R/);
    // The link is built from ATHANORDB_PUBLIC_URL, never the request's Host.
    const token = mail.match(/https:\/\/schemas\.example\.test\/reset-password\/([A-Za-z0-9_-]+)/)?.[1];
    assert.ok(token, "email carries an absolute reset link");
    assert.doesNotMatch(mail, /localhost:3001/);

    // Cooldown: an immediate second request sends nothing new.
    await app.inject({
      method: "POST",
      url: "/api/auth/password-reset/request",
      headers: headers(),
      payload: { email: user.email },
    });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(inbox.filter((m) => m.to.includes(user.email)).length, 1);

    const weak = await app.inject({
      method: "POST",
      url: "/api/auth/password-reset/confirm",
      headers: headers(),
      payload: { token, password: "short" },
    });
    assert.equal(weak.json().code, "PASSWORD_TOO_WEAK");

    const newPassword = "a brand new passphrase for this account";
    const confirmed = await app.inject({
      method: "POST",
      url: "/api/auth/password-reset/confirm",
      headers: headers(),
      payload: { token, password: newPassword },
    });
    assert.equal(confirmed.statusCode, 200);
    assert.equal(confirmed.json().email, user.email);

    const reused = await app.inject({
      method: "POST",
      url: "/api/auth/password-reset/confirm",
      headers: headers(),
      payload: { token, password: "yet another passphrase entirely" },
    });
    assert.equal(reused.json().code, "PASSWORD_RESET_TOKEN_INVALID");

    const staleSession = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: headers({ cookie: oldCookie }),
    });
    assert.equal(staleSession.statusCode, 401, "sessions opened before the reset are gone");

    const oldPassword = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: headers(),
      payload: { email: user.email, password: user.password },
    });
    assert.equal(oldPassword.statusCode, 401);
    const newLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: headers(),
      payload: { email: user.email, password: newPassword },
    });
    assert.equal(newLogin.statusCode, 200);

    // Only the hash is at rest.
    const stored = db.prepare("SELECT token_hash FROM password_reset_tokens").all() as { token_hash: string }[];
    assert.ok(stored.every((row) => row.token_hash !== token));
  } finally {
    await app.close();
  }
});

test("reset links: an expired token and a disabled account are both refused", async () => {
  const app = await buildApp();
  try {
    const user = await makeUser();
    const { issueResetToken } = await import("./passwordReset.js");

    const expiredToken = issueResetToken(user.id)!;
    db.prepare("UPDATE password_reset_tokens SET expires_at = ? WHERE user_id = ?").run(
      new Date(Date.now() - 1000).toISOString(),
      user.id,
    );
    const expired = await app.inject({
      method: "POST",
      url: "/api/auth/password-reset/confirm",
      headers: headers(),
      payload: { token: expiredToken, password: "a perfectly fine passphrase" },
    });
    assert.equal(expired.json().code, "PASSWORD_RESET_TOKEN_INVALID");

    db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(user.id);
    const liveToken = issueResetToken(user.id)!;
    db.prepare("UPDATE users SET disabled_at = datetime('now') WHERE id = ?").run(user.id);
    const disabled = await app.inject({
      method: "POST",
      url: "/api/auth/password-reset/confirm",
      headers: headers(),
      payload: { token: liveToken, password: "a perfectly fine passphrase" },
    });
    assert.equal(disabled.json().code, "PASSWORD_RESET_TOKEN_INVALID");
  } finally {
    await app.close();
  }
});

test("an invitation is emailed to the invitee, with a link that works", async () => {
  const app = await buildApp();
  try {
    const admin = await makeUser(1);
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: headers(),
      payload: { email: admin.email, password: admin.password },
    });
    const cookie = `athanordb_sid=${login.cookies.find((c) => c.name === "athanordb_sid")!.value}`;

    const inviteeEmail = `invitee-${randomUUID()}@example.com`;
    const created = await app.inject({
      method: "POST",
      url: "/api/invitations",
      headers: headers({ cookie }),
      payload: { email: inviteeEmail },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().emailSent, true);

    const mail = await waitForMail(inviteeEmail);
    const token = mail.match(/https:\/\/schemas\.example\.test\/invite\/([A-Za-z0-9-]+)/)?.[1];
    assert.equal(token, created.json().token);

    const accepted = await app.inject({
      method: "POST",
      url: `/api/invitations/${token}/accept`,
      headers: headers(),
      payload: { password: "a perfectly fine passphrase" },
    });
    assert.equal(accepted.statusCode, 200);
  } finally {
    await app.close();
  }
});
