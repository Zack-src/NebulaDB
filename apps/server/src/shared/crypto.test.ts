import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The module under test reaches `infrastructure/db.ts` through `shared/errors.ts`. Without
// this, importing it would open — and migrate — the developer's real `./data` database.
process.env.ATHANORDB_DB_PATH ??= join(tmpdir(), `athanordb-test-crypto-${randomUUID()}.sqlite`);

const { decryptPayload, encryptPayload, reencryptPayload } = await import("./crypto.js");

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

test("a payload written before the format carried a version is still readable", () => {
  const prevSecret = process.env.ATHANORDB_SECRET;
  process.env.ATHANORDB_SECRET = "legacy-format-secret";
  try {
    const current = encryptPayload({ password: "hunter2" });
    assert.match(current, /^v1:/);
    const legacy = current.replace(/^v1:/, "");
    assert.deepEqual(decryptPayload(legacy), { password: "hunter2" });
  } finally {
    process.env.ATHANORDB_SECRET = prevSecret;
  }
});

test("rotation: the previous secret keeps old payloads readable, and reencryptPayload moves them to the new one", () => {
  const prevSecret = process.env.ATHANORDB_SECRET;
  const prevPrevious = process.env.ATHANORDB_SECRET_PREVIOUS;
  try {
    process.env.ATHANORDB_SECRET = "old-secret";
    const old = encryptPayload({ password: "hunter2" });

    process.env.ATHANORDB_SECRET = "new-secret";
    assert.throws(() => decryptPayload(old), "unreadable without the previous secret");

    process.env.ATHANORDB_SECRET_PREVIOUS = "old-secret";
    assert.deepEqual(decryptPayload(old), { password: "hunter2" });
    const rotated = reencryptPayload(old);

    delete process.env.ATHANORDB_SECRET_PREVIOUS;
    assert.deepEqual(decryptPayload(rotated), { password: "hunter2" }, "readable with the new secret alone");
  } finally {
    process.env.ATHANORDB_SECRET = prevSecret;
    if (prevPrevious === undefined) delete process.env.ATHANORDB_SECRET_PREVIOUS;
    else process.env.ATHANORDB_SECRET_PREVIOUS = prevPrevious;
  }
});
