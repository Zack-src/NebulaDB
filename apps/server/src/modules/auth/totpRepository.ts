import crypto from "node:crypto";
import { db } from "../../infrastructure/db.js";
import { decryptPayload, encryptPayload } from "../../shared/crypto.js";
import { hashBackupCode, verifyBackupCode } from "./totp.js";

interface UserTotpRow {
  totp_secret_encrypted: string | null;
  totp_enabled_at: string | null;
}

export interface TotpState {
  /** Set for both a pending (unconfirmed) setup and a fully enabled one — check `enabled` to tell them apart. */
  hasSecret: boolean;
  enabled: boolean;
}

export function getTotpState(userId: string): TotpState {
  const row = db.prepare("SELECT totp_secret_encrypted, totp_enabled_at FROM users WHERE id = ?").get(userId) as
    UserTotpRow | undefined;
  return {
    hasSecret: Boolean(row?.totp_secret_encrypted),
    enabled: Boolean(row?.totp_enabled_at),
  };
}

/** The decrypted secret for a code check — used by both login verification and the setup-confirmation step. */
export function getDecryptedSecret(userId: string): string | null {
  const row = db.prepare("SELECT totp_secret_encrypted FROM users WHERE id = ?").get(userId) as UserTotpRow | undefined;
  if (!row?.totp_secret_encrypted) return null;
  return decryptPayload<string>(row.totp_secret_encrypted);
}

export function isTotpEnabled(userId: string): boolean {
  const row = db.prepare("SELECT totp_enabled_at FROM users WHERE id = ?").get(userId) as
    { totp_enabled_at: string | null } | undefined;
  return Boolean(row?.totp_enabled_at);
}

/** Starts (or restarts) enrollment — stores a fresh secret as pending. Not enabled until `confirmTotp` verifies a real code against it. */
export function startTotpSetup(userId: string, secretBase32: string): void {
  db.prepare("UPDATE users SET totp_secret_encrypted = ?, totp_enabled_at = NULL WHERE id = ?").run(
    encryptPayload(secretBase32),
    userId,
  );
}

export function confirmTotp(userId: string): void {
  db.prepare("UPDATE users SET totp_enabled_at = datetime('now') WHERE id = ?").run(userId);
}

/** Disables 2FA entirely and discards every backup code — the reverse of enrollment, not a pause. */
export function disableTotp(userId: string): void {
  db.transaction(() => {
    db.prepare("UPDATE users SET totp_secret_encrypted = NULL, totp_enabled_at = NULL WHERE id = ?").run(userId);
    db.prepare("DELETE FROM totp_backup_codes WHERE user_id = ?").run(userId);
  })();
}

/** Replaces every backup code (initial issue and explicit regeneration both go through this — there is no "add more" path). */
export function replaceBackupCodes(userId: string, plainCodes: string[]): void {
  db.transaction(() => {
    db.prepare("DELETE FROM totp_backup_codes WHERE user_id = ?").run(userId);
    const insert = db.prepare(
      "INSERT INTO totp_backup_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, datetime('now'))",
    );
    for (const code of plainCodes) {
      insert.run(crypto.randomUUID(), userId, hashBackupCode(code));
    }
  })();
}

export function countUnusedBackupCodes(userId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM totp_backup_codes WHERE user_id = ? AND used_at IS NULL")
    .get(userId) as { n: number };
  return row.n;
}

/**
 * Checks a candidate against every one of the user's unused backup codes
 * (there's no way to look one up by value — only its hash is stored) and, on
 * a match, marks it spent so it can't be reused. Each code is single-use by
 * design: unlike a TOTP code (which naturally rotates every 30s), a backup
 * code that could be replayed would just be a second permanent password.
 */
export function consumeBackupCode(userId: string, candidate: string): boolean {
  const rows = db
    .prepare("SELECT id, code_hash FROM totp_backup_codes WHERE user_id = ? AND used_at IS NULL")
    .all(userId) as { id: string; code_hash: string }[];
  for (const row of rows) {
    if (verifyBackupCode(candidate, row.code_hash)) {
      db.prepare("UPDATE totp_backup_codes SET used_at = datetime('now') WHERE id = ?").run(row.id);
      return true;
    }
  }
  return false;
}

const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** Wrong-code attempts tolerated against one challenge before it's discarded outright — a fresh login has to be started over rather than letting the same challenge absorb unlimited guesses. */
export const MAX_MFA_ATTEMPTS = 5;

interface ChallengeRow {
  id: string;
  user_id: string;
  remember: number;
  attempts: number;
  expires_at: string;
}

export interface MfaChallenge {
  id: string;
  userId: string;
  remember: boolean;
  attempts: number;
}

/** Issued after a correct password when the account has 2FA enabled — a placeholder for "who", not a session. */
export function createMfaChallenge(userId: string, remember: boolean): string {
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + MFA_CHALLENGE_TTL_MS).toISOString();
  db.prepare("INSERT INTO mfa_challenges (id, user_id, remember, attempts, expires_at) VALUES (?, ?, ?, 0, ?)").run(
    id,
    userId,
    remember ? 1 : 0,
    expiresAt,
  );
  return id;
}

/** Live (unexpired) challenge, or null. Does not consume it — call `deleteMfaChallenge` once the code checks out. */
export function getMfaChallenge(id: string): MfaChallenge | null {
  const row = db
    .prepare("SELECT id, user_id, remember, attempts, expires_at FROM mfa_challenges WHERE id = ?")
    .get(id) as ChallengeRow | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM mfa_challenges WHERE id = ?").run(id);
    return null;
  }
  return { id: row.id, userId: row.user_id, remember: row.remember === 1, attempts: row.attempts };
}

/** Records a wrong code. Past `MAX_MFA_ATTEMPTS` the challenge is deleted outright rather than left to expire on its own. */
export function recordMfaFailure(id: string): number {
  const row = db
    .prepare("UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = ? RETURNING attempts")
    .get(id) as { attempts: number } | undefined;
  const attempts = row?.attempts ?? MAX_MFA_ATTEMPTS;
  if (attempts >= MAX_MFA_ATTEMPTS) db.prepare("DELETE FROM mfa_challenges WHERE id = ?").run(id);
  return attempts;
}

export function deleteMfaChallenge(id: string): void {
  db.prepare("DELETE FROM mfa_challenges WHERE id = ?").run(id);
}

export function purgeExpiredMfaChallenges(): number {
  return db.prepare("DELETE FROM mfa_challenges WHERE expires_at < ?").run(new Date().toISOString()).changes;
}
