import type { FastifyInstance } from "fastify";
import { auditUser, listAuditLog } from "../audit.js";
import { db } from "../db.js";
import { checkPassword, hashPassword, verifyPassword } from "../auth/password.js";
import { clearSessionCookie, listSessions, requireAdmin, requireUser } from "../auth/session.js";
import { revalidateAllRooms } from "../yjs/room.js";

interface UserRow {
  id: string;
  email: string;
  is_admin: number;
  display_name: string | null;
  created_at: string;
  disabled_at: string | null;
}

/**
 * Refuses an action that would remove the last account able to administer the
 * instance. Without this, disabling or deleting the only admin leaves an
 * installation with no way back in short of editing SQLite by hand.
 */
/**
 * Removes an account and everything that belongs to it alone, in one
 * transaction. Shared by the admin route and the self-service one so the two
 * can't drift on what gets cleaned up — the failure mode of a divergence here
 * is orphaned rows nobody notices for months.
 *
 * `transferTo` reassigns owned projects; `null` leaves them ownerless (still
 * readable by every logged-in user, manageable only by global admins). Returns
 * how many projects were affected either way.
 *
 * Revision authorship is untouched on purpose: it's a display name captured at
 * edit time, and rewriting history to erase who changed what is the opposite
 * of what an audit trail is for.
 */
function deleteUserRow(userId: string, email: string, transferTo: string | null): number {
  const owned = db.prepare("SELECT COUNT(*) AS n FROM projects WHERE owner_id = ?").get(userId) as { n: number };
  db.transaction(() => {
    db.prepare("UPDATE projects SET owner_id = ? WHERE owner_id = ?").run(transferTo, userId);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM team_members WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM invitations WHERE invited_by = ? AND accepted_at IS NULL").run(userId);
    db.prepare("DELETE FROM login_attempts WHERE email = ?").run(email);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  })();
  return owned.n;
}

function wouldRemoveLastAdmin(userId: string): boolean {
  const target = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId) as { is_admin: number } | undefined;
  if (target?.is_admin !== 1) return false;
  const others = db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND disabled_at IS NULL AND id != ?")
    .get(userId) as { n: number };
  return others.n === 0;
}

export function registerUserRoutes(app: FastifyInstance): void {
  // Admin-only: needed by the Teams admin-console UI's member picker, and by
  // the user administration UI for the disable/delete routes below.
  app.get("/api/users", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const rows = db
      .prepare("SELECT id, email, is_admin, display_name, created_at, disabled_at FROM users ORDER BY created_at ASC")
      .all() as UserRow[];
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      isAdmin: row.is_admin === 1,
      displayName: row.display_name?.trim() || row.email.split("@")[0],
      createdAt: row.created_at,
      disabledAt: row.disabled_at,
    }));
  });

  app.patch("/api/users/me", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { displayName } = (req.body ?? {}) as { displayName?: string };
    const trimmed = displayName?.trim().slice(0, 64);
    if (!trimmed) {
      reply.code(400);
      return { error: "displayName is required" };
    }
    db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(trimmed, user.id);
    return { ...user, displayName: trimmed };
  });

  /**
   * Everything the instance holds about the caller, as one JSON document.
   *
   * Deliberately assembled from the tables rather than dumped generically:
   * "all my data" has to mean something specific, and a generic dump would
   * either leak other people's rows (team members, project collaborators) or
   * quietly miss a table added later. Password hashes are excluded — they are
   * about the account, not data the user provided, and exporting them creates
   * an offline-cracking artefact for no benefit.
   */
  app.get("/api/users/me/export", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;

    const account = db
      .prepare("SELECT id, email, display_name, is_admin, created_at, disabled_at FROM users WHERE id = ?")
      .get(user.id) as {
      id: string;
      email: string;
      display_name: string | null;
      is_admin: number;
      created_at: string;
      disabled_at: string | null;
    };

    const payload = {
      exportedAt: new Date().toISOString(),
      account: {
        id: account.id,
        email: account.email,
        displayName: account.display_name,
        isAdmin: account.is_admin === 1,
        createdAt: account.created_at,
        disabledAt: account.disabled_at,
      },
      sessions: listSessions(user.id, req),
      teams: db
        .prepare(
          `SELECT t.id, t.name, tm.created_at AS joinedAt
           FROM team_members tm JOIN teams t ON t.id = tm.team_id
           WHERE tm.user_id = ? ORDER BY t.name`,
        )
        .all(user.id),
      ownedProjects: db
        .prepare("SELECT id, name, status, created_at AS createdAt FROM projects WHERE owner_id = ? ORDER BY name")
        .all(user.id),
      auditTrail: listAuditLog({ limit: 500 }).filter((entry) => entry.actorId === user.id),
      // Stated rather than silently omitted: schema edits are attributed by
      // display name in each project's own revision log, which is shared
      // content and is not extracted here.
      notIncluded:
        "Schema edits are recorded in each project's revision history under your display name. That history is shared project content, not personal data held about you, and is not part of this export.",
    };

    reply.header("Content-Disposition", `attachment; filename="athanordb-${account.email}.json"`);
    return payload;
  });

  /**
   * Self-service account deletion. Requires the current password — this is
   * irreversible, and a session left open on someone else's machine must not
   * be enough to trigger it.
   *
   * Shares the deletion logic with the admin route below via `deleteUserRow`,
   * so the two can't drift apart on what gets cleaned up. Projects the caller
   * owns are always left ownerless here: they may be shared with a whole team,
   * and letting a departing user hand them to an arbitrary account (or take
   * them down with them) isn't theirs to decide.
   */
  app.delete("/api/users/me", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { password } = (req.body ?? {}) as { password?: string };
    if (!password) {
      reply.code(400);
      return { error: "password is required to delete your account" };
    }
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id) as
      | { password_hash: string }
      | undefined;
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      reply.code(401);
      return { error: "password is incorrect" };
    }
    if (wouldRemoveLastAdmin(user.id)) {
      reply.code(400);
      return { error: "you are the last active administrator — grant admin to someone else first" };
    }

    const owned = deleteUserRow(user.id, user.email, null);
    revalidateAllRooms();
    clearSessionCookie(reply);
    auditUser(user, "user.delete", { type: "user", id: user.id }, `self-service; ${owned} project(s) left ownerless`, req);
    return { deleted: true, projectsAffected: owned };
  });

  // Self-service: requires the current password, unlike the admin reset below.
  app.patch("/api/users/me/password", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { currentPassword, newPassword } = (req.body ?? {}) as { currentPassword?: string; newPassword?: string };
    if (!currentPassword || !newPassword) {
      reply.code(400);
      return { error: "currentPassword and newPassword are required" };
    }
    const check = checkPassword(newPassword, "newPassword");
    if (!check.ok) {
      reply.code(400);
      return { error: check.error };
    }
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id) as
      | { password_hash: string }
      | undefined;
    if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
      reply.code(401);
      return { error: "current password is incorrect" };
    }
    const passwordHash = await hashPassword(check.password);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, user.id);
    return { changed: true };
  });

  // Admin override — no current-password check, since the whole point is
  // recovering a user who can't provide one. Kills every existing session for
  // that account so the old password can't keep being used anywhere it's
  // still logged in.
  app.patch("/api/users/:id/password", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const { id } = req.params as { id: string };
    if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(id)) {
      reply.code(404);
      return { error: "not found" };
    }
    const { newPassword } = (req.body ?? {}) as { newPassword?: string };
    const check = checkPassword(newPassword, "newPassword");
    if (!check.ok) {
      reply.code(400);
      return { error: check.error };
    }
    const passwordHash = await hashPassword(check.password);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    auditUser(admin, "user.password.reset", { type: "user", id }, undefined, req);
    return { reset: true };
  });

  /**
   * Disable / re-enable an account. This is the offboarding path the app was
   * missing entirely: previously an admin could change someone's password but
   * not stop them using the account, so a departed colleague kept working
   * access until someone remembered to change it — and their existing sessions
   * survived even that.
   *
   * Disabling is deliberately the reversible option and the one the UI leads
   * with; `DELETE` below is for when the account must actually go away.
   */
  app.patch("/api/users/:id/disabled", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const { id } = req.params as { id: string };
    const target = db.prepare("SELECT id, email FROM users WHERE id = ?").get(id) as
      | { id: string; email: string }
      | undefined;
    if (!target) {
      reply.code(404);
      return { error: "not found" };
    }
    const { disabled } = (req.body ?? {}) as { disabled?: boolean };
    if (typeof disabled !== "boolean") {
      reply.code(400);
      return { error: "disabled must be a boolean" };
    }
    if (disabled && id === admin.id) {
      reply.code(400);
      return { error: "you cannot disable your own account" };
    }
    if (disabled && wouldRemoveLastAdmin(id)) {
      reply.code(400);
      return { error: "this is the last active administrator" };
    }

    if (disabled) {
      db.transaction(() => {
        db.prepare("UPDATE users SET disabled_at = datetime('now') WHERE id = ?").run(id);
        // Existing sessions are the whole point: leaving them alive would mean
        // a disabled account keeps working until each one expires.
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
      })();
      // Any WebSocket they still hold open resolves its access again and is
      // closed — `resolveSession` now refuses disabled accounts, but a socket
      // authenticated before the change is already past that check.
      revalidateAllRooms();
    } else {
      db.prepare("UPDATE users SET disabled_at = NULL WHERE id = ?").run(id);
    }
    auditUser(admin, disabled ? "user.disable" : "user.enable", { type: "user", id }, target.email, req);
    return { id, disabled };
  });

  /**
   * Permanently delete an account.
   *
   * What happens to what they left behind is an explicit choice, not a
   * cascade: team memberships and pending invitations they sent go away with
   * them, but projects they own are either transferred to another account
   * (`transferProjectsTo`) or left ownerless. An ownerless project stays
   * readable by every logged-in user and manageable by global admins — the
   * same state a project created before ownership existed is in — and there is
   * currently no route to re-assign one, so the transfer option is the way to
   * avoid a one-way door.
   *
   * Revision authorship is left untouched on purpose: it is a display name
   * captured at edit time, not a foreign key, and rewriting history to erase
   * who made a change is the opposite of what an audit trail is for.
   */
  app.delete("/api/users/:id", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const { id } = req.params as { id: string };
    const target = db.prepare("SELECT id, email FROM users WHERE id = ?").get(id) as
      | { id: string; email: string }
      | undefined;
    if (!target) {
      reply.code(404);
      return { error: "not found" };
    }
    if (id === admin.id) {
      reply.code(400);
      return { error: "you cannot delete your own account" };
    }
    if (wouldRemoveLastAdmin(id)) {
      reply.code(400);
      return { error: "this is the last active administrator" };
    }

    const { transferProjectsTo } = (req.body ?? {}) as { transferProjectsTo?: string };
    if (transferProjectsTo !== undefined) {
      if (transferProjectsTo === id || !db.prepare("SELECT 1 FROM users WHERE id = ?").get(transferProjectsTo)) {
        reply.code(400);
        return { error: "transferProjectsTo must be another existing user" };
      }
    }

    const owned = deleteUserRow(id, target.email, transferProjectsTo ?? null);
    revalidateAllRooms();

    auditUser(
      admin,
      "user.delete",
      { type: "user", id },
      `${target.email}; ${owned} project(s) ${transferProjectsTo ? "transferred" : "left ownerless"}`,
      req,
    );
    return { deleted: true, projectsAffected: owned, transferred: Boolean(transferProjectsTo) };
  });
}
