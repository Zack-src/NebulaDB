import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { config } from "../../config.js";
import { db } from "../../infrastructure/db.js";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { parseBody, z } from "../../shared/validate.js";
import { normalizeEmail } from "../auth/email.js";
import { checkPassword, hashPassword } from "../auth/password.js";
import { createSession } from "../auth/session.js";

/**
 * First-run setup from the browser: while the instance has no account at all,
 * `POST /api/setup` creates the first administrator and signs them in. It is
 * the browser twin of `npm run bootstrap-admin`, which stays the way in for
 * headless installs.
 *
 * The risk is plain: a fresh instance reachable by others can be claimed by
 * whoever gets there first. `NEBULADB_SETUP_TOKEN` closes that — when set, the
 * request must carry it. Once one account exists the route answers
 * `SETUP_ALREADY_DONE` forever, whatever it is sent.
 */

/** Same per-IP budget as the login: the route hashes a password (scrypt) and is open to anyone. */
const SETUP_RATE_LIMIT = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

const MAX_DISPLAY_NAME_LENGTH = 64;

const setupBody = z.object({
  email: z.string().optional(),
  password: z.string().optional(),
  displayName: z.string().optional(),
  token: z.string().optional(),
});

async function hasAnyUser(): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM users LIMIT 1").get()) !== undefined;
}

/** Constant-time: both sides are hashed first, so neither the content nor the length of the token leaks through timing. */
function tokenMatches(given: string | undefined, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(given ?? ""), digest(expected));
}

export function registerSetupRoutes(app: FastifyInstance): void {
  /** Public. `tokenRequired` only says whether a token is configured, never anything about it. */
  app.get("/api/setup/status", async () => ({
    needsSetup: !(await hasAnyUser()),
    tokenRequired: config.setupToken !== null,
  }));

  app.post("/api/setup", SETUP_RATE_LIMIT, async (req, reply) => {
    // First, and cheap: once set up, nothing below runs — no token check, no hashing, no lock.
    if (await hasAnyUser()) throw new ApiError("SETUP_ALREADY_DONE");

    const body = parseBody(setupBody, req);
    if (config.setupToken !== null && !tokenMatches(body.token, config.setupToken)) {
      throw new ApiError("SETUP_TOKEN_INVALID");
    }
    const email = normalizeEmail(body.email);
    if (!email) throw new ApiError("EMAIL_INVALID");
    const displayName = body.displayName?.trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
    if (!displayName) throw new ApiError("DISPLAY_NAME_REQUIRED");
    const check = checkPassword(body.password);
    if (!check.ok) throw new ApiError("PASSWORD_TOO_WEAK", { message: check.error });

    // Hashed outside the transaction: ~100 ms that must not be spent holding the lock below.
    const passwordHash = await hashPassword(check.password);
    const id = crypto.randomUUID();

    // Check-and-create under a table lock. SHARE ROW EXCLUSIVE conflicts with
    // itself and with every INSERT into `users`, so two setups (or a setup and
    // `bootstrap-admin`) cannot both see zero accounts: the second waits, then
    // recounts and finds the first one's admin.
    const created = await db.transaction(async () => {
      await db.exec("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE");
      if (await hasAnyUser()) return false;
      await db
        .prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, 1, ?)")
        .run(id, email, passwordHash, displayName);
      return true;
    });
    if (!created) throw new ApiError("SETUP_ALREADY_DONE");

    await auditUser({ id, email }, "setup.completed", { type: "user", id }, undefined, req);
    req.log.warn({ email }, "first-run setup completed: first administrator created");
    await createSession(id, reply, req);
    return { id, email, isAdmin: true, displayName };
  });
}
