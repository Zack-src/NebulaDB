import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Same reason as session.test.ts: `db.ts` opens its SQLite file at import
// time, so the path has to be set before anything imports it transitively.
process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-lockout-test-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";

const { db } = await import("../db.js");
const { checkLock, clearFailures, purgeStaleAttempts, recordFailure, MAX_FAILED_ATTEMPTS } = await import(
  "./lockout.js"
);

function freshEmail(): string {
  return `${randomUUID()}@example.com`;
}

test("an account with no history is not locked", () => {
  assert.equal(checkLock(freshEmail()).locked, false);
});

test("failures below the threshold do not lock", () => {
  const email = freshEmail();
  for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
    assert.equal(recordFailure(email).locked, false, `attempt ${i + 1} should not lock`);
  }
  assert.equal(checkLock(email).locked, false);
});

test("the attempt that reaches the threshold reports the lock itself", () => {
  const email = freshEmail();
  let state = { locked: false } as { locked: boolean; until?: string };
  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) state = recordFailure(email);
  // Reported on the tripping attempt rather than only on the next one — the
  // login route needs to answer 429 immediately, not accept one more try.
  assert.equal(state.locked, true);
  assert.ok(state.until, "reports when the lock lifts");
  assert.equal(checkLock(email).locked, true);
});

test("a successful login clears the counter", () => {
  const email = freshEmail();
  for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) recordFailure(email);
  clearFailures(email);
  assert.equal(checkLock(email).locked, false);
  // And the count really is back to zero, not just under the threshold.
  for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
    assert.equal(recordFailure(email).locked, false);
  }
});

test("an expired lock lifts and resets the counter instead of re-locking on the next typo", () => {
  const email = freshEmail();
  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) recordFailure(email);
  // Backdate the lock rather than waiting 15 minutes.
  db.prepare("UPDATE login_attempts SET locked_until = ? WHERE email = ?").run(
    new Date(Date.now() - 1000).toISOString(),
    email,
  );
  assert.equal(checkLock(email).locked, false, "expired lock lifts");
  const row = db.prepare("SELECT failures FROM login_attempts WHERE email = ?").get(email) as { failures: number };
  assert.equal(row.failures, 0, "counter reset, so one more failure doesn't immediately re-lock");
  assert.equal(recordFailure(email).locked, false);
});

test("purgeStaleAttempts drops old unlocked rows but keeps locked ones", () => {
  const stale = freshEmail();
  const locked = freshEmail();
  const recent = freshEmail();

  recordFailure(stale);
  db.prepare("UPDATE login_attempts SET last_failure_at = datetime('now', '-2 days') WHERE email = ?").run(stale);

  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) recordFailure(locked);
  db.prepare("UPDATE login_attempts SET last_failure_at = datetime('now', '-2 days') WHERE email = ?").run(locked);

  recordFailure(recent);

  purgeStaleAttempts();

  const exists = (email: string) => Boolean(db.prepare("SELECT 1 FROM login_attempts WHERE email = ?").get(email));
  assert.equal(exists(stale), false, "old unlocked row removed");
  assert.equal(exists(locked), true, "an active lock survives the sweep even when old");
  assert.equal(exists(recent), true, "recent failures are kept");
});
