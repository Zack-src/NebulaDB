import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPassword, hashPassword, verifyPassword, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from "./password.js";

test("checkPassword rejects missing, too-short and too-long values", () => {
  assert.equal(checkPassword(undefined).ok, false);
  assert.equal(checkPassword("").ok, false);
  assert.equal(checkPassword("a".repeat(MIN_PASSWORD_LENGTH - 1)).ok, false);
  assert.equal(checkPassword("a".repeat(MAX_PASSWORD_LENGTH + 1)).ok, false);
  assert.equal(checkPassword(12345678 as unknown).ok, false, "non-string input is rejected, not coerced");
});

test("checkPassword accepts anything in [MIN, MAX] and narrows the type", () => {
  const result = checkPassword("a".repeat(MIN_PASSWORD_LENGTH));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.password.length, MIN_PASSWORD_LENGTH);
  assert.equal(checkPassword("a".repeat(MAX_PASSWORD_LENGTH)).ok, true);
});

test("checkPassword's error message includes the caller-supplied label", () => {
  const result = checkPassword("", "new password");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /new password/);
});

test("hashPassword -> verifyPassword round-trips, and rejects the wrong password", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  assert.equal(await verifyPassword("wrong password entirely", hash), false);
});

test("hashPassword salts every call, so the same password never hashes the same way twice", async () => {
  const [a, b] = await Promise.all([hashPassword("same password"), hashPassword("same password")]);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("same password", a), true);
  assert.equal(await verifyPassword("same password", b), true);
});

test("verifyPassword rejects an over-length candidate before doing any hashing work", async () => {
  const hash = await hashPassword("a reasonable password");
  assert.equal(await verifyPassword("x".repeat(MAX_PASSWORD_LENGTH + 1), hash), false);
});

test("verifyPassword rejects a malformed stored hash instead of throwing", async () => {
  assert.equal(await verifyPassword("anything", "not-a-real-hash"), false);
  assert.equal(await verifyPassword("anything", "scrypt:only:four:parts"), false);
  assert.equal(await verifyPassword("anything", "bcrypt:1:2:3:salt:hash"), false, "wrong algorithm tag");
});

test("hashPassword's stored format encodes N/r/p so a future cost-tuning change doesn't break existing hashes", async () => {
  const hash = await hashPassword("whatever");
  const [algo, n, r, p] = hash.split(":");
  assert.equal(algo, "scrypt");
  assert.equal(Number(n) > 0, true);
  assert.equal(Number(r) > 0, true);
  assert.equal(Number(p) > 0, true);
});
