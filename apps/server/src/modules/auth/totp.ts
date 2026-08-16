import crypto from "node:crypto";

/**
 * TOTP (RFC 6238, built on the HOTP counter algorithm of RFC 4226) and backup
 * codes for two-factor login. Hand-rolled on `node:crypto` rather than adding
 * a dependency (`otplib`/`speakeasy`) — the algorithm is ~40 lines of HMAC and
 * modular arithmetic, well below the bar this codebase already uses elsewhere
 * for "implement it, don't depend on it" (see `password.ts`'s scrypt-based
 * hashing and `email.ts`'s regex, both hand-written for the same reason).
 * `hotp()`'s test coverage includes the RFC 4226 Appendix D vectors verbatim,
 * so this isn't an unverified reimplementation of the spec.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
/** Secret length in bytes — 160 bits, the size RFC 4226 itself recommends and what every authenticator app expects. */
const SECRET_BYTES = 20;
const DEFAULT_DIGITS = 6;
const DEFAULT_STEP_SECONDS = 30;
/** Accept the current 30s step plus one on either side — covers ordinary clock drift between server and phone without materially widening the guessable window. */
const DEFAULT_WINDOW = 1;

/** RFC 4648 base32, no padding — the encoding every TOTP authenticator app expects for manual secret entry. */
export function base32Encode(buffer: Buffer): string {
  let bits = "";
  for (const byte of buffer) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  const remainder = bits.length % 5;
  if (remainder > 0) {
    const lastChunk = bits.slice(bits.length - remainder).padEnd(5, "0");
    out += BASE32_ALPHABET[parseInt(lastChunk, 2)];
  }
  return out;
}

export function base32Decode(encoded: string): Buffer {
  const clean = encoded.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function generateSecret(): Buffer {
  return crypto.randomBytes(SECRET_BYTES);
}

/** RFC 4226 HOTP: HMAC-SHA1 over an 8-byte big-endian counter, dynamically truncated to `digits` decimal digits. */
export function hotp(secret: Buffer, counter: number, digits = DEFAULT_DIGITS): string {
  const counterBuffer = Buffer.alloc(8);
  // Split into two 32-bit halves — `counterBuffer.writeBigUInt64BE` would be the
  // direct way, but this avoids requiring callers to pass a BigInt for what is,
  // for any realistic TOTP counter (time/30, won't overflow a 32-bit int for
  // millennia), always a plain `number`.
  counterBuffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);

  const hmac = crypto.createHmac("sha1", secret).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const truncated =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const code = String(truncated % 10 ** digits).padStart(digits, "0");
  return code;
}

/** Current TOTP code for a base32-encoded secret, at `atTimeMs` (defaults to now). */
export function totp(
  secretBase32: string,
  atTimeMs: number = Date.now(),
  step = DEFAULT_STEP_SECONDS,
  digits = DEFAULT_DIGITS,
): string {
  const counter = Math.floor(atTimeMs / 1000 / step);
  return hotp(base32Decode(secretBase32), counter, digits);
}

/**
 * Verifies a user-supplied code against a window of counters centred on now,
 * to absorb ordinary clock drift between the server and the authenticator
 * device. Constant-time compare per candidate — codes are short (6 digits)
 * so this mostly matters as habit, not as a meaningful timing defence (the
 * real defence against guessing is the attempt cap in `routes.ts`).
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  options: { window?: number; step?: number; digits?: number; atTimeMs?: number } = {},
): boolean {
  const {
    window = DEFAULT_WINDOW,
    step = DEFAULT_STEP_SECONDS,
    digits = DEFAULT_DIGITS,
    atTimeMs = Date.now(),
  } = options;
  const trimmed = code.trim();
  if (!/^\d+$/.test(trimmed) || trimmed.length !== digits) return false;
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(atTimeMs / 1000 / step);
  const candidate = Buffer.from(trimmed);

  for (let delta = -window; delta <= window; delta++) {
    const expected = Buffer.from(hotp(secret, counter + delta, digits));
    if (expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate)) return true;
  }
  return false;
}

export function otpauthUrl(secretBase32: string, accountEmail: string, issuer = "AthanorDB"): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(DEFAULT_DIGITS),
    period: String(DEFAULT_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Characters that read unambiguously out loud and can't be confused with each other in most fonts — no 0/O, 1/I/L. */
const BACKUP_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function randomBackupCode(): string {
  const bytes = crypto.randomBytes(8);
  let out = "";
  for (const byte of bytes) out += BACKUP_CODE_ALPHABET[byte % BACKUP_CODE_ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}`;
}

/** One-time recovery codes, issued when 2FA is enabled (and again on explicit regeneration) — the way in if the authenticator device is lost. */
export function generateBackupCodes(count = 10): string[] {
  return Array.from({ length: count }, randomBackupCode);
}

/**
 * Backup codes are high-entropy random tokens (8 chars from a 32-symbol
 * alphabet, 40 bits), not user-chosen low-entropy secrets — unlike a
 * password, there's no dictionary-attack risk that scrypt's deliberate
 * slowness is defending against, so a plain fast hash is the right tool here
 * rather than reusing `password.ts`'s scrypt for something it wasn't built
 * for. Normalized (uppercased, hyphen stripped) before hashing so a user
 * pasting a code without its formatting still matches.
 */
export function hashBackupCode(code: string): string {
  const normalized = code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export function verifyBackupCode(code: string, hash: string): boolean {
  const candidate = Buffer.from(hashBackupCode(code), "hex");
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}
