import { db } from "../../infrastructure/db.js";

/**
 * Per-account brute-force protection, complementary to (not a replacement for)
 * the per-IP rate limit on `POST /api/auth/login`.
 *
 * The IP limit stops one host hammering the login route; it does nothing about
 * a slow or distributed attempt that stays under 10 requests a minute per
 * address while working through a password list against one account, and it
 * leaves no record that anything happened. This counts failures against the
 * account itself, wherever they come from.
 */

/** Failed attempts tolerated before the account is temporarily locked. */
export const MAX_FAILED_ATTEMPTS = 10;

/** How long the lock lasts once tripped. */
const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Failure rows for accounts that are no longer locked and haven't failed
 * within this window are swept away — they carry no information at that point.
 * Expressed as a SQLite modifier rather than a JS timestamp on purpose:
 * `last_failure_at` is written by `utc_now()` (`YYYY-MM-DD HH:MM:SS`),
 * which does not sort correctly against a JS `toISOString()` value for rows
 * landing on the same date.
 */
const STALE_ATTEMPT_WINDOW = "-1 day";

interface AttemptRow {
  failures: number;
  locked_until: string | null;
}

export interface LockState {
  locked: boolean;
  /** ISO timestamp the lock lifts at — only set when `locked` is true. */
  until?: string;
}

/**
 * Whether login is currently blocked for this account, clearing the lock if it has expired.
 *
 * Deliberate tradeoff: only real accounts get a lock row, so tripping a lock reveals that an
 * address is registered. Accepted for a self-hosted team tool, in exchange for telling a
 * legitimate user why they are locked out.
 */
export async function checkLock(email: string): Promise<LockState> {
  const row = (await db.prepare("SELECT failures, locked_until FROM login_attempts WHERE email = ?").get(email)) as
    AttemptRow | undefined;
  if (!row?.locked_until) return { locked: false };
  if (new Date(row.locked_until).getTime() > Date.now()) return { locked: true, until: row.locked_until };
  // Lock expired — reset rather than leaving the counter at the threshold,
  // which would otherwise re-lock the account on the very next typo.
  await db.prepare("UPDATE login_attempts SET failures = 0, locked_until = NULL WHERE email = ?").run(email);
  return { locked: false };
}

/**
 * Records one failed attempt for an existing account, locking it once the
 * threshold is reached. Returns the resulting state so the caller can report
 * the lock on the attempt that trips it, rather than only on the next one.
 */
export async function recordFailure(email: string): Promise<LockState> {
  // One statement, so the count is the database's: read first and written
  // back, wrong passwords tried in parallel would each see the same count and
  // the threshold would never be reached.
  const lockAt = new Date(Date.now() + LOCKOUT_MS).toISOString();
  const row = (await db
    .prepare(
      `INSERT INTO login_attempts (email, failures, locked_until, last_failure_at)
     VALUES (?, 1, CASE WHEN 1 >= ? THEN ? END, utc_now())
     ON CONFLICT(email) DO UPDATE SET
       failures = login_attempts.failures + 1,
       locked_until = CASE WHEN login_attempts.failures + 1 >= ? THEN ? END,
       last_failure_at = excluded.last_failure_at
     RETURNING locked_until`,
    )
    .get(email, MAX_FAILED_ATTEMPTS, lockAt, MAX_FAILED_ATTEMPTS, lockAt)) as { locked_until: string | null };
  return row.locked_until ? { locked: true, until: row.locked_until } : { locked: false };
}

/** Clears the counter after a successful login. */
export async function clearFailures(email: string): Promise<void> {
  await db.prepare("DELETE FROM login_attempts WHERE email = ?").run(email);
}

/** Drops rows that are neither locked nor recently active. Called from the same periodic sweep as expired sessions. */
export async function purgeStaleAttempts(): Promise<number> {
  return (
    await db
      .prepare(
        `DELETE FROM login_attempts
       WHERE locked_until IS NULL
         AND (last_failure_at IS NULL OR last_failure_at < utc_now(?))`,
      )
      .run(STALE_ATTEMPT_WINDOW)
  ).changes;
}
