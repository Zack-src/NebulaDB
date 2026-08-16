import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Same pattern as `session.test.ts`: the env vars have to be set before
// anything transitively imports `db.ts` (module-level `new Database(...)`) or
// `shared/crypto.ts` (reads `ATHANORDB_SECRET` lazily, but every test below
// exercises the encrypted-secret path so it needs to be set regardless).
process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-totp-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";

const { db } = await import("../../infrastructure/db.js");
const {
  confirmTotp,
  consumeBackupCode,
  countUnusedBackupCodes,
  createMfaChallenge,
  deleteMfaChallenge,
  disableTotp,
  getDecryptedSecret,
  getMfaChallenge,
  getTotpState,
  isTotpEnabled,
  MAX_MFA_ATTEMPTS,
  recordMfaFailure,
  replaceBackupCodes,
  startTotpSetup,
} = await import("./totpRepository.js");

function insertUser(): string {
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, 0, NULL)").run(
    id,
    `${id}@example.com`,
    "irrelevant-for-these-tests",
  );
  return id;
}

test("startTotpSetup stores a pending (not-yet-enabled) secret; confirmTotp enables it", () => {
  const userId = insertUser();
  assert.deepEqual(getTotpState(userId), { hasSecret: false, enabled: false });
  assert.equal(isTotpEnabled(userId), false);

  startTotpSetup(userId, "JBSWY3DPEHPK3PXP");
  assert.deepEqual(getTotpState(userId), { hasSecret: true, enabled: false });
  assert.equal(isTotpEnabled(userId), false, "a pending secret must not gate login yet");
  assert.equal(getDecryptedSecret(userId), "JBSWY3DPEHPK3PXP");

  confirmTotp(userId);
  assert.deepEqual(getTotpState(userId), { hasSecret: true, enabled: true });
  assert.equal(isTotpEnabled(userId), true);
});

test("the stored secret is encrypted at rest, not the plain base32 value", () => {
  const userId = insertUser();
  startTotpSetup(userId, "JBSWY3DPEHPK3PXP");
  const row = db.prepare("SELECT totp_secret_encrypted FROM users WHERE id = ?").get(userId) as {
    totp_secret_encrypted: string;
  };
  assert.notEqual(row.totp_secret_encrypted, "JBSWY3DPEHPK3PXP");
  assert.ok(row.totp_secret_encrypted.includes(":"), "expected the iv:authTag:ciphertext shape from shared/crypto.ts");
});

test("disableTotp clears the secret and discards every backup code", () => {
  const userId = insertUser();
  startTotpSetup(userId, "JBSWY3DPEHPK3PXP");
  confirmTotp(userId);
  replaceBackupCodes(userId, ["AAAA-1111", "BBBB-2222"]);
  assert.equal(countUnusedBackupCodes(userId), 2);

  disableTotp(userId);
  assert.deepEqual(getTotpState(userId), { hasSecret: false, enabled: false });
  assert.equal(countUnusedBackupCodes(userId), 0);
});

test("replaceBackupCodes discards the previous set entirely, not additively", () => {
  const userId = insertUser();
  replaceBackupCodes(userId, ["AAAA-1111", "BBBB-2222", "CCCC-3333"]);
  assert.equal(countUnusedBackupCodes(userId), 3);

  replaceBackupCodes(userId, ["DDDD-4444"]);
  assert.equal(countUnusedBackupCodes(userId), 1);
  // The old codes are really gone, not just uncounted.
  assert.equal(consumeBackupCode(userId, "AAAA-1111"), false);
  assert.equal(consumeBackupCode(userId, "DDDD-4444"), true);
});

test("consumeBackupCode is single-use: a second attempt with the same code fails", () => {
  const userId = insertUser();
  replaceBackupCodes(userId, ["AAAA-1111"]);
  assert.equal(consumeBackupCode(userId, "AAAA-1111"), true);
  assert.equal(countUnusedBackupCodes(userId), 0);
  assert.equal(consumeBackupCode(userId, "AAAA-1111"), false, "a spent code must not verify again");
});

test("consumeBackupCode never matches another user's code", () => {
  const userA = insertUser();
  const userB = insertUser();
  replaceBackupCodes(userA, ["AAAA-1111"]);
  assert.equal(consumeBackupCode(userB, "AAAA-1111"), false);
  assert.equal(consumeBackupCode(userA, "AAAA-1111"), true);
});

test("createMfaChallenge/getMfaChallenge round-trip, and deleteMfaChallenge really removes it", () => {
  const userId = insertUser();
  const id = createMfaChallenge(userId, true);
  const challenge = getMfaChallenge(id);
  assert.ok(challenge);
  assert.equal(challenge!.userId, userId);
  assert.equal(challenge!.remember, true);
  assert.equal(challenge!.attempts, 0);

  deleteMfaChallenge(id);
  assert.equal(getMfaChallenge(id), null);
});

test("getMfaChallenge returns null for an unknown id without throwing", () => {
  assert.equal(getMfaChallenge(randomUUID()), null);
});

test("getMfaChallenge treats an expired row as gone and cleans it up", () => {
  const userId = insertUser();
  const id = createMfaChallenge(userId, false);
  // Back-date it past its TTL directly — the repository has no "expire now"
  // hook by design, so this reaches into the row the way real elapsed time
  // would.
  db.prepare("UPDATE mfa_challenges SET expires_at = datetime('now', '-1 hour') WHERE id = ?").run(id);
  assert.equal(getMfaChallenge(id), null);
  const stillThere = db.prepare("SELECT 1 FROM mfa_challenges WHERE id = ?").get(id);
  assert.equal(stillThere, undefined, "an expired challenge should be deleted on read, not just ignored");
});

test("recordMfaFailure counts attempts and discards the challenge once the cap is reached", () => {
  const userId = insertUser();
  const id = createMfaChallenge(userId, true);

  for (let i = 1; i < MAX_MFA_ATTEMPTS; i++) {
    const attempts = recordMfaFailure(id);
    assert.equal(attempts, i);
    assert.ok(getMfaChallenge(id), `challenge should still exist after ${i} failure(s)`);
  }

  const final = recordMfaFailure(id);
  assert.equal(final, MAX_MFA_ATTEMPTS);
  assert.equal(getMfaChallenge(id), null, "challenge should be gone once the attempt cap is hit");
});
