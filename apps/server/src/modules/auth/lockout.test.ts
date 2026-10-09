import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

// Same reason as session.test.ts: `db.ts` connects at import time, so its
// database has to be there before anything imports it transitively.
await useTestDatabase("lockout");
process.env.NEBULADB_COOKIE_SECURE = "false";

const { db } = await import("../../infrastructure/db.js");
const { checkLock, clearFailures, purgeStaleAttempts, recordFailure, MAX_FAILED_ATTEMPTS } =
  await import("./lockout.js");

function freshEmail(): string {
  return `${randomUUID()}@example.com`;
}

test("an account with no history is not locked", async () => {
  assert.equal((await checkLock(freshEmail())).locked, false);
});

test("failures below the threshold do not lock", async () => {
  const email = freshEmail();
  for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
    assert.equal((await recordFailure(email)).locked, false, `attempt ${i + 1} should not lock`);
  }
  assert.equal((await checkLock(email)).locked, false);
});

test("the attempt that reaches the threshold reports the lock itself", async () => {
  const email = freshEmail();
  let state = { locked: false } as { locked: boolean; until?: string };
  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) state = await recordFailure(email);
  // Reported on the tripping attempt rather than only on the next one — the
  // login route needs to answer 429 immediately, not accept one more try.
  assert.equal(state.locked, true);
  assert.ok(state.until, "reports when the lock lifts");
  assert.equal((await checkLock(email)).locked, true);
});

test("a successful login clears the counter", async () => {
  const email = freshEmail();
  for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) await recordFailure(email);
  await clearFailures(email);
  assert.equal((await checkLock(email)).locked, false);
  // And the count really is back to zero, not just under the threshold.
  for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
    assert.equal((await recordFailure(email)).locked, false);
  }
});

test("an expired lock lifts and resets the counter instead of re-locking on the next typo", async () => {
  const email = freshEmail();
  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await recordFailure(email);
  // Backdate the lock rather than waiting 15 minutes.
  await db
    .prepare("UPDATE login_attempts SET locked_until = ? WHERE email = ?")
    .run(new Date(Date.now() - 1000).toISOString(), email);
  assert.equal((await checkLock(email)).locked, false, "expired lock lifts");
  const row = (await db.prepare("SELECT failures FROM login_attempts WHERE email = ?").get(email)) as {
    failures: number;
  };
  assert.equal(row.failures, 0, "counter reset, so one more failure doesn't immediately re-lock");
  assert.equal((await recordFailure(email)).locked, false);
});

test("purgeStaleAttempts drops old unlocked rows but keeps locked ones", async () => {
  const stale = freshEmail();
  const locked = freshEmail();
  const recent = freshEmail();

  await recordFailure(stale);
  await db.prepare("UPDATE login_attempts SET last_failure_at = utc_now('-2 days') WHERE email = ?").run(stale);

  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await recordFailure(locked);
  await db.prepare("UPDATE login_attempts SET last_failure_at = utc_now('-2 days') WHERE email = ?").run(locked);

  await recordFailure(recent);

  await purgeStaleAttempts();

  const exists = async (email: string) =>
    Boolean(await db.prepare("SELECT 1 FROM login_attempts WHERE email = ?").get(email));
  assert.equal(await exists(stale), false, "old unlocked row removed");
  assert.equal(await exists(locked), true, "an active lock survives the sweep even when old");
  assert.equal(await exists(recent), true, "recent failures are kept");
});
