import test from "node:test";
import assert from "node:assert/strict";
import {
  base32Decode,
  base32Encode,
  generateBackupCodes,
  generateSecret,
  hashBackupCode,
  hotp,
  otpauthUrl,
  totp,
  verifyBackupCode,
  verifyTotp,
} from "./totp.js";

test("hotp matches the RFC 4226 Appendix D test vectors", () => {
  // The RFC's own 20-byte ASCII test secret, and its published HOTP output
  // for counters 0-9 at 6 digits — this pins the implementation against the
  // spec itself, not just against its own round-trip.
  const secret = Buffer.from("12345678901234567890", "ascii");
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  for (let counter = 0; counter < expected.length; counter++) {
    assert.equal(hotp(secret, counter), expected[counter]);
  }
});

test("base32Encode/base32Decode round-trip arbitrary bytes", () => {
  for (let i = 0; i < 20; i++) {
    const original = generateSecret();
    const encoded = base32Encode(original);
    assert.match(encoded, /^[A-Z2-7]+$/);
    assert.deepEqual(base32Decode(encoded), original);
  }
});

test("totp/verifyTotp round-trip: the current code verifies, a stale one doesn't", () => {
  const secret = base32Encode(generateSecret());
  const now = 1_700_000_000_000;
  const code = totp(secret, now);
  assert.equal(verifyTotp(secret, code, { atTimeMs: now }), true);

  // Five steps (150s) away is well outside the default ±1 step window.
  const staleCode = totp(secret, now - 5 * 30 * 1000);
  assert.equal(verifyTotp(secret, staleCode, { atTimeMs: now }), false);
});

test("verifyTotp accepts the adjacent step either side (clock drift tolerance) but not two steps away", () => {
  const secret = base32Encode(generateSecret());
  const now = 1_700_000_000_000;
  const nextStepCode = totp(secret, now + 30 * 1000);
  const prevStepCode = totp(secret, now - 30 * 1000);
  const twoStepsAwayCode = totp(secret, now + 2 * 30 * 1000);

  assert.equal(verifyTotp(secret, nextStepCode, { atTimeMs: now }), true);
  assert.equal(verifyTotp(secret, prevStepCode, { atTimeMs: now }), true);
  assert.equal(verifyTotp(secret, twoStepsAwayCode, { atTimeMs: now }), false);
});

test("verifyTotp rejects garbage input without throwing", () => {
  const secret = base32Encode(generateSecret());
  assert.equal(verifyTotp(secret, "abcdef"), false);
  assert.equal(verifyTotp(secret, "12345"), false); // too short
  assert.equal(verifyTotp(secret, ""), false);
  assert.equal(verifyTotp(secret, "1234567"), false); // too long
});

test("otpauthUrl embeds the secret, issuer and account label", () => {
  const url = otpauthUrl("JBSWY3DPEHPK3PXP", "alice@example.com", "AthanorDB");
  assert.ok(url.startsWith("otpauth://totp/AthanorDB%3Aalice%40example.com?"));
  const params = new URL(url).searchParams;
  assert.equal(params.get("secret"), "JBSWY3DPEHPK3PXP");
  assert.equal(params.get("issuer"), "AthanorDB");
  assert.equal(params.get("digits"), "6");
  assert.equal(params.get("period"), "30");
});

test("generateBackupCodes returns the requested count of distinct, formatted codes", () => {
  const codes = generateBackupCodes(10);
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10, "codes should not collide");
  for (const code of codes) assert.match(code, /^[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}$/);
});

test("hashBackupCode/verifyBackupCode round-trip, case- and formatting-insensitive", () => {
  const [code] = generateBackupCodes(1);
  const hash = hashBackupCode(code);
  assert.equal(verifyBackupCode(code, hash), true);
  assert.equal(verifyBackupCode(code.toLowerCase(), hash), true);
  assert.equal(verifyBackupCode(code.replace("-", ""), hash), true);
  assert.equal(verifyBackupCode(` ${code} `, hash), true);
});

test("verifyBackupCode rejects a wrong or tampered code", () => {
  const [codeA, codeB] = generateBackupCodes(2);
  const hashA = hashBackupCode(codeA);
  assert.equal(verifyBackupCode(codeB, hashA), false);
  assert.equal(verifyBackupCode("0000-0000", hashA), false);
});
