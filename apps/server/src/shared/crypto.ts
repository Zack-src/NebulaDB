import crypto from "node:crypto";
import { ApiError } from "./errors.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/**
 * Generic at-rest encryption keyed by `ATHANORDB_SECRET`, shared by every
 * caller that needs to store something more sensitive than a hash: a live
 * database connection's credentials (`modules/connections`, the first thing
 * this app ever encrypted at rest — see `docs/todo.md` Phase 27) and a TOTP
 * secret (`modules/auth/totp.ts`) both go through this one file rather than
 * each rolling their own AES call. Originally lived under
 * `modules/connections/` and moved here once a second, unrelated caller
 * needed the same primitive — a module named after one feature is the wrong
 * home for a cross-cutting one.
 *
 * There is deliberately no fallback key derived from something already on
 * disk (the DB path, a hardcoded string): this file is public — MIT-licensed,
 * on GitHub — so any fallback baked into it is not a secret, and encrypting
 * with it would be worse than not encrypting at all (it *looks* protected).
 * Failing loudly here, at the point a feature actually needs it, matches
 * `config.ts`'s "fail fast on a missing secret" policy for the cookie
 * signing key — just scoped to the one request path that needs it, so a
 * fresh install that never configures a live DB connection or 2FA isn't
 * refused a boot over an unrelated env var.
 */
function encryptionKey(): Buffer {
  const secret = process.env.ATHANORDB_SECRET;
  if (!secret || secret.trim() === "") {
    // An `ApiError`, not a plain `Error`: the generic error handler masks any
    // other throw behind a bare "internal server error" (an internal message
    // — a SQL string, a file path — must never reach the client), which is
    // exactly wrong here. This one *is* the actionable message: an operator
    // who hasn't set the env var needs to see the `openssl` line, not a dead
    // end that only shows up in the server's own log.
    throw new ApiError("CONNECTION_SECRET_MISSING", {
      message:
        "ATHANORDB_SECRET must be set before this can be stored — it is the encryption key for sensitive data at " +
        "rest (database connection credentials, two-factor secrets). Generate one with `openssl rand -hex 32` and " +
        "set it before using either feature.",
    });
  }
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptPayload(data: unknown): string {
  const key = encryptionKey();
  const text = JSON.stringify(data);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

export function decryptPayload<T = unknown>(encryptedString: string): T {
  const key = encryptionKey();
  const parts = encryptedString.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted payload format");
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return JSON.parse(decrypted) as T;
}
