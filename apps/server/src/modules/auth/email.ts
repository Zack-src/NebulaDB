/**
 * Email validation for the few places that accept one (login, invitations,
 * bootstrap-admin). Previously each site only checked for an `"@"`, which
 * accepted `"a@"`, `"a@b@c"` and `"@b"`.
 *
 * Deliberately a pragmatic subset of RFC 5322 rather than the full grammar:
 * one `@`, a non-empty local part without spaces or a second `@`, and a domain
 * with at least one dot and a 2+ character TLD. Anything stricter starts
 * rejecting addresses that really exist.
 */
const EMAIL_RE =
  /^[^\s@,;:<>"()[\]\\]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

export const MAX_EMAIL_LENGTH = 254; // RFC 5321 upper bound on a forward path

export function isValidEmail(value: string): boolean {
  return value.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(value);
}

/** Trims + lowercases, returning null when the result isn't a usable address. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return isValidEmail(normalized) ? normalized : null;
}
