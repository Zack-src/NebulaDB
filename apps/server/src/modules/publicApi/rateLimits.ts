/**
 * Shared per-route rate-limit configs for the `/api/v1` surface — looser
 * than the auth-facing rate limits (login, invite-accept), since this is
 * meant to be called from CI/scripts rather than a browser, but still a real
 * ceiling: an external caller with a leaked key shouldn't be able to hammer
 * the server unboundedly through it. Same `config.rateLimit` shape
 * `@fastify/rate-limit` reads everywhere else in the app.
 */
export const API_RATE_LIMIT = { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } };
/** Deploy/rollback execute real SQL against a real database — a much tighter ceiling than a read/import call. */
export const DEPLOY_RATE_LIMIT = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };
