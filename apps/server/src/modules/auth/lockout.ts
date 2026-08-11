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
export const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Failure rows for accounts that are no longer locked and haven't failed
 * within this window are swept away — they carry no information at that point.
 * Expressed as a SQLite modifier rather than a JS timestamp on purpose:
 * `last_failure_at` is written by `datetime('now')` (`YYYY-MM-DD HH:MM:SS`),
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
 * Whether login is currently blocked for this account, clearing the lock if it
 * has expired.
 *
 * Note the deliberate enumeration tradeoff: `recordFailure` only ever writes a
 * row for an email that actually has an account, so a caller who can trip a
 * lock learns that the address is registered. That is accepted here — this is
 * a self-hosted team tool where colleagues' addresses aren't secret, and the
 * alternative (a generic "invalid credentials" for a locked account) leaves a
 * legitimate user with a correct password locked out and no explanation for
 * fifteen minutes. It also keeps the table bounded by the number of real
 * accounts instead of by the number of addresses an attacker can invent.
 */
export function checkLock(email: string): LockState {
  const row = db.prepare("SELECT failures, locked_until FROM login_attempts WHERE email = ?").get(email) as
    | AttemptRow
    | undefined;
  if (!row?.locked_until) return { locked: false };
  if (new Date(row.locked_until).getTime() > Date.now()) return { locked: true, until: row.locked_until };
  // Lock expired — reset rather than leaving the counter at the threshold,
  // which would otherwise re-lock the account on the very next typo.
  db.prepare("UPDATE login_attempts SET failures = 0, locked_until = NULL WHERE email = ?").run(email);
  return { locked: false };
}

/**
 * Records one failed attempt for an existing account, locking it once the
 * threshold is reached. Returns the resulting state so the caller can report
 * the lock on the attempt that trips it, rather than only on the next one.
 */
export function recordFailure(email: string): LockState {
  const row = db.prepare("SELECT failures, locked_until FROM login_attempts WHERE email = ?").get(email) as
    | AttemptRow
    | undefined;
  const failures = (row?.failures ?? 0) + 1;
  const lockedUntil = failures >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS).toISOString() : null;
  db.prepare(
    `INSERT INTO login_attempts (email, failures, locked_until, last_failure_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(email) DO UPDATE SET
       failures = excluded.failures,
       locked_until = excluded.locked_until,
       last_failure_at = excluded.last_failure_at`,
  ).run(email, failures, lockedUntil);
  return lockedUntil ? { locked: true, until: lockedUntil } : { locked: false };
}

/** Clears the counter after a successful login. */
export function clearFailures(email: string): void {
  db.prepare("DELETE FROM login_attempts WHERE email = ?").run(email);
}

/** Drops rows that are neither locked nor recently active. Called from the same periodic sweep as expired sessions. */
export function purgeStaleAttempts(): number {
  return db
    .prepare(
      `DELETE FROM login_attempts
       WHERE locked_until IS NULL
         AND (last_failure_at IS NULL OR last_failure_at < datetime('now', ?))`,
    )
    .run(STALE_ATTEMPT_WINDOW).changes;
}
