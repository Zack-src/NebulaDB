import { readEnv } from "./brandMigration.js";
import crypto from "node:crypto";
import { ApiError } from "./errors.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/**
 * At-rest encryption keyed by `NEBULADB_SECRET`, shared by everything stored encrypted
 * (database connection credentials, TOTP secrets).
 *
 * No fallback key: the source is public, so any baked-in key would only *look* protected. It
 * fails loudly when a feature actually needs the secret, so a fresh install that uses neither
 * connections nor 2FA still boots.
 */
function deriveKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptionKey(): Buffer {
  const secret = readEnv("NEBULADB_SECRET");
  if (!secret || secret.trim() === "") {
    // An `ApiError`, not a plain `Error`: the generic error handler masks any
    // other throw behind a bare "internal server error" (an internal message
    // — a SQL string, a file path — must never reach the client), which is
    // exactly wrong here. This one *is* the actionable message: an operator
    // who hasn't set the env var needs to see the `openssl` line, not a dead
    // end that only shows up in the server's own log.
    throw new ApiError("CONNECTION_SECRET_MISSING", {
      message:
        "NEBULADB_SECRET must be set before this can be stored — it is the encryption key for sensitive data at " +
        "rest (database connection credentials, two-factor secrets). Generate one with `openssl rand -hex 32` and " +
        "set it before using either feature.",
    });
  }
  return deriveKey(secret);
}

/**
 * The key being rotated *away from*, if any. While `NEBULADB_SECRET_PREVIOUS`
 * is set, anything still encrypted with it stays readable, so a rotation is
 * "set the new secret, keep the old one as PREVIOUS, run `npm run
 * rotate-secret`, then drop PREVIOUS" rather than a flag day that leaves every
 * stored connection undecryptable.
 */
function previousEncryptionKey(): Buffer | null {
  const secret = readEnv("NEBULADB_SECRET_PREVIOUS");
  if (!secret || secret.trim() === "") return null;
  return deriveKey(secret);
}

/** Payloads written before the format carried a version are the bare `iv:tag:ciphertext` — still read, never written. */
const FORMAT_VERSION = "v1";

export function encryptPayload(data: unknown): string {
  const key = encryptionKey();
  const text = JSON.stringify(data);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return `${FORMAT_VERSION}:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

function decryptWith(key: Buffer, ivHex: string, authTagHex: string, encryptedHex: string): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function splitPayload(encryptedString: string): [string, string, string] {
  const parts = encryptedString.split(":");
  if (parts.length === 4 && parts[0] === FORMAT_VERSION) return [parts[1], parts[2], parts[3]];
  if (parts.length === 3) return [parts[0], parts[1], parts[2]];
  throw new Error("Invalid encrypted payload format");
}

export function decryptPayload<T = unknown>(encryptedString: string): T {
  const [ivHex, authTagHex, encryptedHex] = splitPayload(encryptedString);
  const key = encryptionKey();
  try {
    return JSON.parse(decryptWith(key, ivHex, authTagHex, encryptedHex)) as T;
  } catch (err) {
    const previous = previousEncryptionKey();
    if (!previous) throw err;
    return JSON.parse(decryptWith(previous, ivHex, authTagHex, encryptedHex)) as T;
  }
}

/** Re-encrypts a stored payload with the current key and format — the unit of work of `rotate-secret`. */
export function reencryptPayload(encryptedString: string): string {
  return encryptPayload(decryptPayload(encryptedString));
}
