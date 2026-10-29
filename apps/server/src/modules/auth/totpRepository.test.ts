import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

// Same pattern as `session.test.ts`: the env vars have to be set before
// anything transitively imports `db.ts` (which connects as it is imported) or
// `shared/crypto.ts` (reads `NEBULADB_SECRET` lazily, but every test below
// exercises the encrypted-secret path so it needs to be set regardless).
await useTestDatabase("totp");
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";

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

async function insertUser(): Promise<string> {
  const id = randomUUID();
  await db
    .prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, 0, NULL)")
    .run(id, `${id}@example.com`, "irrelevant-for-these-tests");
  return id;
}

test("startTotpSetup stores a pending (not-yet-enabled) secret; confirmTotp enables it", async () => {
  const userId = await insertUser();
  assert.deepEqual(await getTotpState(userId), { hasSecret: false, enabled: false });
  assert.equal(await isTotpEnabled(userId), false);

  await startTotpSetup(userId, "JBSWY3DPEHPK3PXP");
  assert.deepEqual(await getTotpState(userId), { hasSecret: true, enabled: false });
  assert.equal(await isTotpEnabled(userId), false, "a pending secret must not gate login yet");
  assert.equal(await getDecryptedSecret(userId), "JBSWY3DPEHPK3PXP");

  await confirmTotp(userId);
  assert.deepEqual(await getTotpState(userId), { hasSecret: true, enabled: true });
  assert.equal(await isTotpEnabled(userId), true);
});

test("the stored secret is encrypted at rest, not the plain base32 value", async () => {
  const userId = await insertUser();
  await startTotpSetup(userId, "JBSWY3DPEHPK3PXP");
  const row = (await db.prepare("SELECT totp_secret_encrypted FROM users WHERE id = ?").get(userId)) as {
    totp_secret_encrypted: string;
  };
  assert.notEqual(row.totp_secret_encrypted, "JBSWY3DPEHPK3PXP");
  assert.ok(row.totp_secret_encrypted.includes(":"), "expected the iv:authTag:ciphertext shape from shared/crypto.ts");
});

test("disableTotp clears the secret and discards every backup code", async () => {
  const userId = await insertUser();
  await startTotpSetup(userId, "JBSWY3DPEHPK3PXP");
  await confirmTotp(userId);
  await replaceBackupCodes(userId, ["AAAA-1111", "BBBB-2222"]);
  assert.equal(await countUnusedBackupCodes(userId), 2);

  await disableTotp(userId);
  assert.deepEqual(await getTotpState(userId), { hasSecret: false, enabled: false });
  assert.equal(await countUnusedBackupCodes(userId), 0);
});

test("replaceBackupCodes discards the previous set entirely, not additively", async () => {
  const userId = await insertUser();
  await replaceBackupCodes(userId, ["AAAA-1111", "BBBB-2222", "CCCC-3333"]);
  assert.equal(await countUnusedBackupCodes(userId), 3);

  await replaceBackupCodes(userId, ["DDDD-4444"]);
  assert.equal(await countUnusedBackupCodes(userId), 1);
  // The old codes are really gone, not just uncounted.
  assert.equal(await consumeBackupCode(userId, "AAAA-1111"), false);
  assert.equal(await consumeBackupCode(userId, "DDDD-4444"), true);
});

test("consumeBackupCode is single-use: a second attempt with the same code fails", async () => {
  const userId = await insertUser();
  await replaceBackupCodes(userId, ["AAAA-1111"]);
  assert.equal(await consumeBackupCode(userId, "AAAA-1111"), true);
  assert.equal(await countUnusedBackupCodes(userId), 0);
  assert.equal(await consumeBackupCode(userId, "AAAA-1111"), false, "a spent code must not verify again");
});

test("consumeBackupCode never matches another user's code", async () => {
  const userA = await insertUser();
  const userB = await insertUser();
  await replaceBackupCodes(userA, ["AAAA-1111"]);
  assert.equal(await consumeBackupCode(userB, "AAAA-1111"), false);
  assert.equal(await consumeBackupCode(userA, "AAAA-1111"), true);
});

test("createMfaChallenge/getMfaChallenge round-trip, and deleteMfaChallenge really removes it", async () => {
  const userId = await insertUser();
  const id = await createMfaChallenge(userId, true);
  const challenge = await getMfaChallenge(id);
  assert.ok(challenge);
  assert.equal(challenge!.userId, userId);
  assert.equal(challenge!.remember, true);
  assert.equal(challenge!.attempts, 0);

  await deleteMfaChallenge(id);
  assert.equal(await getMfaChallenge(id), null);
});

test("getMfaChallenge returns null for an unknown id without throwing", async () => {
  assert.equal(await getMfaChallenge(randomUUID()), null);
});

test("getMfaChallenge treats an expired row as gone and cleans it up", async () => {
  const userId = await insertUser();
  const id = await createMfaChallenge(userId, false);
  // Back-date it past its TTL directly — the repository has no "expire now"
  // hook by design, so this reaches into the row the way real elapsed time
  // would.
  await db.prepare("UPDATE mfa_challenges SET expires_at = utc_now('-1 hour') WHERE id = ?").run(id);
  assert.equal(await getMfaChallenge(id), null);
  const stillThere = await db.prepare("SELECT 1 FROM mfa_challenges WHERE id = ?").get(id);
  assert.equal(stillThere, undefined, "an expired challenge should be deleted on read, not just ignored");
});

test("recordMfaFailure counts attempts and discards the challenge once the cap is reached", async () => {
  const userId = await insertUser();
  const id = await createMfaChallenge(userId, true);

  for (let i = 1; i < MAX_MFA_ATTEMPTS; i++) {
    const attempts = await recordMfaFailure(id);
    assert.equal(attempts, i);
    assert.ok(await getMfaChallenge(id), `challenge should still exist after ${i} failure(s)`);
  }

  const final = await recordMfaFailure(id);
  assert.equal(final, MAX_MFA_ATTEMPTS);
  assert.equal(await getMfaChallenge(id), null, "challenge should be gone once the attempt cap is hit");
});

test("a backup code presented twice at the same moment is accepted once", async () => {
  const userId = await insertUser();
  await replaceBackupCodes(userId, ["RACE-0001"]);
  const outcomes = await Promise.all(Array.from({ length: 6 }, () => consumeBackupCode(userId, "RACE-0001")));
  assert.equal(outcomes.filter(Boolean).length, 1);
  assert.equal(await countUnusedBackupCodes(userId), 0);
});
