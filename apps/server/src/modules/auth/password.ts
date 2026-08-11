import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// Encoding N/r/p into the stored hash (rather than hardcoding them at verify
// time) means a future tuning change doesn't invalidate every existing
// password. Node's built-in scrypt avoids adding a native-binding dependency
// (bcrypt/argon2) on top of the one this project already carries for
// better-sqlite3.
//
// Cost: N=65536, r=8, p=1 -> 64MB and ~100ms per hash on a modern desktop
// (measured), i.e. roughly 250-500ms on the small VPS/NAS hardware this is
// typically self-hosted on. That's a deliberate step below OWASP's current
// N=2^17 recommendation: 2^17 needs 128MB *per concurrent hash*, which is a
// real memory-exhaustion lever on a 1-2GB box. The gap is covered on the other
// side instead — login is rate limited and passwords are length-capped, so an
// attacker can't cheaply force many expensive hashes. Revisit if this ever runs
// somewhere with memory to spare.
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
