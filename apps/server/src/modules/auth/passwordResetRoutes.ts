import type { FastifyInstance } from "fastify";
import { appUrl, isMailEnabled, sendMail } from "../../infrastructure/mailer.js";
import { revalidateAllRooms } from "../../realtime/roomRegistry.js";
import { auditUser } from "../../shared/audit.js";
import { passwordResetEmail } from "../../shared/emailTemplates.js";
import { ApiError } from "../../shared/errors.js";
import { normalizeEmail } from "./email.js";
import { clearFailures } from "./lockout.js";
import { checkPassword, hashPassword } from "./password.js";
import { RESET_TOKEN_TTL_MINUTES, consumeResetToken, findResettableUser, issueResetToken } from "./passwordReset.js";

/** Per IP. The per-account cooldown in `passwordReset.ts` covers one target being hammered from many IPs. */
const REQUEST_RATE_LIMIT = { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } };
/** Same budget as login: the token is the only credential here, and each attempt pays for a scrypt hash. */
const CONFIRM_RATE_LIMIT = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

export function registerPasswordResetRoutes(app: FastifyInstance): void {
  /** What the login screen may offer. Public: it gates a link on a page nobody is logged into yet. */
  app.get("/api/auth/features", async () => ({ passwordReset: isMailEnabled() }));

  /**
   * Always answers the same thing, whether or not the address has an account
   * — the form must not become a way to find out who uses this instance. The
   * email itself goes out after the response, so the response time doesn't
   * give the answer away either (an SMTP round-trip only happens for real
   * accounts).
   */
  app.post("/api/auth/password-reset/request", REQUEST_RATE_LIMIT, async (req) => {
    if (!isMailEnabled()) throw new ApiError("PASSWORD_RESET_UNAVAILABLE");
    const { email } = (req.body ?? {}) as { email?: string };
    const normalized = normalizeEmail(email);
    if (!normalized) throw new ApiError("EMAIL_INVALID");

    const user = findResettableUser(normalized);
    const token = user ? issueResetToken(user.id) : null;
    if (user && token) {
      auditUser(null, "user.password.reset_request", { type: "user", id: user.id }, user.email, req);
      const mail = passwordResetEmail(user.email, appUrl(`/reset-password/${token}`), RESET_TOKEN_TTL_MINUTES);
      setImmediate(() => {
        sendMail(mail).catch((err: unknown) => req.log.error({ err }, "password reset email failed"));
      });
    }
    return { requested: true };
  });

  app.post("/api/auth/password-reset/confirm", CONFIRM_RATE_LIMIT, async (req) => {
    const { token, password } = (req.body ?? {}) as { token?: string; password?: string };
    if (!token) throw new ApiError("PASSWORD_RESET_TOKEN_INVALID");
    const check = checkPassword(password);
    if (!check.ok) throw new ApiError("PASSWORD_TOO_WEAK", { message: check.error });

    const user = consumeResetToken(token, await hashPassword(check.password));
    if (!user) throw new ApiError("PASSWORD_RESET_TOKEN_INVALID");

    // Proving control of the mailbox is exactly what an account lockout is
    // waiting for — without this, a locked-out user who resets still can't log in.
    clearFailures(user.email);
    // Sessions were deleted with the password; this closes their live sockets too.
    revalidateAllRooms();
    auditUser(user, "user.password.reset_self", { type: "user", id: user.id }, undefined, req);
    return { email: user.email };
  });
}
