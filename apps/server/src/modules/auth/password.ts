import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// N/r/p are stored in the hash so tuning later doesn't invalidate existing passwords.
// Node's scrypt avoids a native bcrypt/argon2 dependency.
// Cost: N=65536, r=8, p=1 -> 64MB, ~100ms per hash. Deliberately below OWASP's N=2^17
// (128MB per concurrent hash is a memory lever on small hosts); login rate limiting and
// length-capped passwords cover the gap.
const N = 65536;
const r = 8;
const p = 1;
const KEY_LENGTH = 64;
// Node's default maxmem is 32MB, which N=65536 exceeds — without this the call
// throws instead of hashing.
const MAX_MEM = 192 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 8;
/**
 * scrypt cost is independent of input length, but every byte still has to be
 * read and hashed, and an unbounded password is free CPU amplification for an
 * attacker on the login route. 128 is far past any real passphrase.
 */
export const MAX_PASSWORD_LENGTH = 128;

/** The passwords every cracking list starts with (those long enough to pass the length rule), compared lower-cased. */
const COMMON_PASSWORDS = new Set(
  `12345678 123456789 1234567890 12345678910 11111111 00000000 87654321 password password1 password12 password123
  passw0rd p@ssw0rd p@ssword qwertyui qwerty123 qwertyuiop 1q2w3e4r 1q2w3e4r5t 1qaz2wsx zaq12wsx abcd1234 abc12345
  abcdefgh iloveyou letmein1 welcome1 welcome123 admin123 administrator changeme changeme123 trustno1 sunshine
  princess football baseball monkey123 dragon123 superman master123 azertyui azerty123 motdepasse nebuladb
  nebuladb1 nebuladb123 admin1234 test1234 testtest username 11223344 12341234 123123123 987654321`.split(/\s+/),
);

export type PasswordCheck = { ok: true; password: string } | { ok: false; error: string };

/** Validates an untrusted password value, narrowing it to a `string` on success. */
export function checkPassword(password: unknown, label = "password"): PasswordCheck {
  if (typeof password !== "string" || password.length === 0) return { ok: false, error: `${label} is required` };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `${label} must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, error: `${label} must be at most ${MAX_PASSWORD_LENGTH} characters` };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase()) || /^(.)\1+$/.test(password)) {
    return { ok: false, error: `${label} is too common — choose a longer, less guessable one` };
  }
  return { ok: true, password };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, { N, r, p, maxmem: MAX_MEM });
  return `scrypt:${N}:${r}:${p}:${salt.toString("base64")}:${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  // Reject over-long candidates before doing any work — the login route checks
  // this too, but verification is also reachable from password-change routes.
  if (password.length > MAX_PASSWORD_LENGTH) return false;
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const derived = await scrypt(password, salt, expected.length, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
    maxmem: MAX_MEM,
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
