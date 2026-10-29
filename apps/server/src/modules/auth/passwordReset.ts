import crypto from "node:crypto";
import { db } from "../../infrastructure/db.js";

/**
 * Storage for self-service password reset tokens. The plaintext token only
 * ever exists in the emailed link; the table holds its SHA-256 (see migration
 * 16), so reading the database — or a backup of it — yields nothing usable.
 */

export const RESET_TOKEN_TTL_MINUTES = 60;
/** A second request for the same account inside this window sends nothing — stops the form being used to flood someone's inbox. */
const RESET_REQUEST_COOLDOWN_MS = 60_000;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export interface ResetTarget {
  id: string;
  email: string;
}

/** The account a reset may be issued for: exists and isn't disabled. `undefined` otherwise — the caller must not reveal which. */
export async function findResettableUser(email: string): Promise<ResetTarget | undefined> {
  return (await db.prepare("SELECT id, email FROM users WHERE email = ? AND disabled_at IS NULL").get(email)) as
    ResetTarget | undefined;
}

async function hasRecentRequest(userId: string): Promise<boolean> {
  const since = new Date(Date.now() - RESET_REQUEST_COOLDOWN_MS).toISOString();
  return Boolean(
    await db
      .prepare("SELECT 1 FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL AND created_at >= ?")
      .get(userId, since),
  );
}

/**
 * Issues a fresh token, invalidating any the account still had outstanding —
 * only the most recent email's link works, so an older one sitting in an
 * inbox can't be used later. Returns `null` inside the cooldown window.
 */
export async function issueResetToken(userId: string): Promise<string | null> {
  if (await hasRecentRequest(userId)) return null;
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000).toISOString();
  await db.transaction(async () => {
    await db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL").run(userId);
    // `created_at` written explicitly in the same ISO format `hasRecentRequest`
    // compares against — the column's `utc_now()` default uses a space, not a `T`.
    await db
      .prepare("INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(hashToken(token), userId, expiresAt, new Date().toISOString());
  });
  return token;
}

/**
 * Claims a token and swaps the password in one transaction. The conditional
 * UPDATE is the single-use guarantee: two concurrent submits of the same link
 * both pass any read-then-check, but only one can flip `used_at`. Returns the
 * account on success, `null` for a token that is unknown, used, expired, or
 * belongs to an account disabled since the email went out.
 */
export async function consumeResetToken(token: string, newPasswordHash: string): Promise<ResetTarget | null> {
  const tokenHash = hashToken(token);
  return await db.transaction(async (): Promise<ResetTarget | null> => {
    const row = (await db
      .prepare(
        `SELECT u.id, u.email FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
         WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at > ? AND u.disabled_at IS NULL`,
      )
      .get(tokenHash, new Date().toISOString())) as ResetTarget | undefined;
    if (!row) return null;
    const claimed = await db
      .prepare("UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL")
      .run(new Date().toISOString(), tokenHash);
    if (claimed.changes === 0) return null;
    await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newPasswordHash, row.id);
    // Every other session goes: whoever prompted the reset may be the person
    // the account needs protecting from. Other outstanding links go too.
    await db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.id);
    await db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL").run(row.id);
    return row;
  });
}

/** Hourly sweep, alongside sessions — expired and used tokens carry no information. */
export async function purgeExpiredResetTokens(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return (
    await db
      .prepare("DELETE FROM password_reset_tokens WHERE expires_at < ? OR (used_at IS NOT NULL AND used_at < ?)")
      .run(new Date().toISOString(), cutoff)
  ).changes;
}
