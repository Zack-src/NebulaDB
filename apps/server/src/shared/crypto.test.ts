import test from "node:test";
import assert from "node:assert/strict";
import { decryptPayload, encryptPayload } from "./crypto.js";

test("encryptPayload and decryptPayload round-trip objects securely", () => {
  const prevSecret = process.env.ATHANORDB_SECRET;
  process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
  try {
    const secretData = {
      host: "db.example.com",
      port: 5432,
      password: "SuperSecretPassword123!",
      ssl: true,
    };

    const encrypted = encryptPayload(secretData);
    assert.ok(typeof encrypted === "string");
    assert.notEqual(encrypted, JSON.stringify(secretData));
    assert.ok(encrypted.includes(":"));

    const decrypted = decryptPayload<typeof secretData>(encrypted);
    assert.deepEqual(decrypted, secretData);
  } finally {
    process.env.ATHANORDB_SECRET = prevSecret;
  }
});

test("decryptPayload throws error on tampered data", () => {
  const prevSecret = process.env.ATHANORDB_SECRET;
  process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
  try {
    const encrypted = encryptPayload({ a: 1 });
    const parts = encrypted.split(":");
    // Tamper ciphertext
    const tampered = `${parts[0]}:${parts[1]}:badhex1234`;
    assert.throws(() => decryptPayload(tampered));
  } finally {
    process.env.ATHANORDB_SECRET = prevSecret;
  }
});

test("encryptPayload refuses to derive a key from nothing — no hardcoded fallback", () => {
  const prevSecret = process.env.ATHANORDB_SECRET;
  delete process.env.ATHANORDB_SECRET;
  try {
    assert.throws(() => encryptPayload({ a: 1 }), /ATHANORDB_SECRET/);
  } finally {
    process.env.ATHANORDB_SECRET = prevSecret;
  }
});

test("two different ATHANORDB_SECRET values produce non-interchangeable ciphertext", () => {
  const prevSecret = process.env.ATHANORDB_SECRET;
  try {
    process.env.ATHANORDB_SECRET = "secret-one";
    const encrypted = encryptPayload({ password: "hunter2" });

    process.env.ATHANORDB_SECRET = "secret-two";
    assert.throws(() => decryptPayload(encrypted));
  } finally {
    process.env.ATHANORDB_SECRET = prevSecret;
  }
});
