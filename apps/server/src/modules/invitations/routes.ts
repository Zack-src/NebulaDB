import type { FastifyInstance } from "fastify";
import { auditUser } from "../../shared/audit.js";
import { db } from "../../infrastructure/db.js";
import { normalizeEmail } from "../auth/email.js";
import { checkPassword, hashPassword } from "../auth/password.js";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin } from "../../shared/guards.js";
import { appUrl, isMailEnabled, sendMail } from "../../infrastructure/mailer.js";
import { invitationEmail } from "../../shared/emailTemplates.js";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface InvitationRow {
  token: string;
  email: string;
  is_admin: number;
  invited_by: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

const INVITATION_COLUMNS = "token, email, is_admin, invited_by, created_at, expires_at, accepted_at";

function getInvitationStatus(row: InvitationRow): "pending" | "accepted" | "expired" {
  if (row.accepted_at) return "accepted";
  if (new Date(row.expires_at).getTime() < Date.now()) return "expired";
  return "pending";
}

const ACCEPT_RATE_LIMIT = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

export function registerInvitationRoutes(app: FastifyInstance): void {
  app.post("/api/invitations", async (req, reply) => {
    const admin = requireAdmin(req);

    const { email, isAdmin } = (req.body ?? {}) as { email?: string; isAdmin?: boolean };
    const normalized = normalizeEmail(email);
    if (!normalized) throw new ApiError("EMAIL_INVALID");
    if (db.prepare("SELECT id FROM users WHERE email = ?").get(normalized)) {
      throw new ApiError("EMAIL_ALREADY_EXISTS");
    }

    // Only one pending invite per email makes sense — replace rather than accumulate.
    db.prepare("DELETE FROM invitations WHERE email = ? AND accepted_at IS NULL").run(normalized);

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS).toISOString();
    db.prepare("INSERT INTO invitations (token, email, is_admin, invited_by, expires_at) VALUES (?, ?, ?, ?, ?)").run(
      token,
      normalized,
      isAdmin ? 1 : 0,
      admin.id,
      expiresAt,
    );

    auditUser(
      admin,
      "invitation.create",
      { type: "invitation", id: token },
      `${normalized}${isAdmin ? " (admin)" : ""}`,
      req,
    );
    // With email configured the invitee gets the link directly; without it (or
    // if the send fails) the admin still gets `inviteUrl` to pass on by hand,
    // exactly as before. A failed send doesn't fail the invitation — it
    // already exists, and the admin can still copy the link.
    let emailSent = false;
    if (isMailEnabled()) {
      try {
        await sendMail(
          invitationEmail(normalized, appUrl(`/invite/${token}`), admin.displayName || admin.email, new Date(expiresAt)),
        );
        emailSent = true;
      } catch (err) {
        req.log.error({ err }, "invitation email failed");
      }
    }
    return reply.code(201).send({ token, inviteUrl: `/invite/${token}`, email: normalized, expiresAt, emailSent });
  });

  app.get("/api/invitations", async (req) => {
    requireAdmin(req);
    const rows = db
      .prepare(`SELECT ${INVITATION_COLUMNS} FROM invitations ORDER BY created_at DESC`)
      .all() as InvitationRow[];
    return rows.map((row) => ({
      token: row.token,
      email: row.email,
      isAdmin: row.is_admin === 1,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      status: getInvitationStatus(row),
    }));
  });

  app.delete("/api/invitations/:token", async (req) => {
    const admin = requireAdmin(req);
    const { token } = req.params as { token: string };
    db.prepare("DELETE FROM invitations WHERE token = ? AND accepted_at IS NULL").run(token);
    auditUser(admin, "invitation.revoke", { type: "invitation", id: token }, undefined, req);
    return { revoked: true };
  });

  // Public — this is the one way to create an account without already having one.
  // Rate limited per IP: the token is the only credential, and the route both
  // hashes a password (expensive) and creates an account.
  app.post("/api/invitations/:token/accept", ACCEPT_RATE_LIMIT, async (req) => {
    const { token } = req.params as { token: string };
    const invitation = db.prepare(`SELECT ${INVITATION_COLUMNS} FROM invitations WHERE token = ?`).get(token) as
      InvitationRow | undefined;
    if (!invitation || getInvitationStatus(invitation) !== "pending") throw new ApiError("INVITATION_INVALID");

    const { password } = (req.body ?? {}) as { password?: string };
    const check = checkPassword(password);
    if (!check.ok) throw new ApiError("PASSWORD_TOO_WEAK", { message: check.error });

    const passwordHash = await hashPassword(check.password);
    const id = crypto.randomUUID();

    // Re-check the invitation *inside* the transaction and claim it with a
    // conditional UPDATE. Two concurrent accepts of the same token used to both
    // pass the check above and both INSERT, with the loser blowing up on the
    // `users.email` UNIQUE constraint as an unhandled 500. Now the second one
    // finds `accepted_at` already set and rolls back cleanly.
    const claimInvitation = db.transaction(() => {
      const claimed = db
        .prepare("UPDATE invitations SET accepted_at = datetime('now') WHERE token = ? AND accepted_at IS NULL")
        .run(token);
      if (claimed.changes === 0) return false;
      if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(invitation.email)) return false;
      db.prepare("INSERT INTO users (id, email, password_hash, is_admin) VALUES (?, ?, ?, ?)").run(
        id,
        invitation.email,
        passwordHash,
        invitation.is_admin,
      );
      return true;
    });

    let created: boolean;
    try {
      created = claimInvitation();
    } catch (err) {
      req.log.error({ err }, "invitation accept failed");
      throw new ApiError("INVITATION_FAILED");
    }
    if (!created) throw new ApiError("INVITATION_ALREADY_USED");

    // Deliberately no createSession() here: the account exists now, but we
    // send the user to the real login form for their first sign-in instead of
    // auto-logging them in. That's the only reliable way to get the browser's
    // own password manager to offer to save the credential it just typed —
    // Credential Management API `store()` (called client-side once this
    // resolves) covers Chromium browsers, and an actual username+password
    // form submission on /login is the fallback everywhere else.
    // The actor here is the brand-new account itself, not an admin — this is
    // the row that ties an account's existence to the invitation it came from.
    auditUser({ id, email: invitation.email }, "invitation.accept", { type: "invitation", id: token }, undefined, req);
    return { email: invitation.email };
  });
}
