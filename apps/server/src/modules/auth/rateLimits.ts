/**
 * For every route that checks a password or a second factor outside the login
 * flow (changing the password, deleting the account, turning 2FA off…): as
 * tight as the login itself. Each password check is a scrypt run (64 MiB of
 * memory), and with a stolen session these routes are a way to guess the
 * current password or the TOTP code. Signed-in callers are counted per user
 * (see the `keyGenerator` in `app.ts`), so spreading the guesses over many
 * IPs gains nothing.
 */
export const CREDENTIAL_RATE_LIMIT = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };
