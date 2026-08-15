import type { FastifyInstance } from "fastify";
import { auditUser } from "../../../shared/audit.js";
import { checkPassword, hashPassword, verifyPassword } from "../../auth/password.js";
import { clearSessionCookie } from "../../auth/session.js";
import { ApiError } from "../../../shared/errors.js";
import { requireUser } from "../../../shared/guards.js";
import { revalidateAllRooms } from "../../../realtime/room.js";
import { getPasswordHash, updateDisplayName, updatePasswordHash } from "../repository.js";
import { buildPersonalDataExport, deleteUserAccount, wouldRemoveLastAdmin } from "../service.js";

const MAX_DISPLAY_NAME_LENGTH = 64;

/** Confirms the caller really is who the session says — required before anything irreversible. */
async function verifyOwnPassword(
  userId: string,
  password: string,
  failure: "PASSWORD_INCORRECT" | "CURRENT_PASSWORD_INCORRECT",
) {
  const hash = getPasswordHash(userId);
  if (!hash || !(await verifyPassword(password, hash))) throw new ApiError(failure);
}

/** Routes acting on the caller's own account. */
export function registerAccountRoutes(app: FastifyInstance): void {
  app.patch("/api/users/me", async (req) => {
    const user = requireUser(req);
    const { displayName } = (req.body ?? {}) as { displayName?: string };
    const trimmed = displayName?.trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
    if (!trimmed) throw new ApiError("DISPLAY_NAME_REQUIRED");
    updateDisplayName(user.id, trimmed);
    return { ...user, displayName: trimmed };
  });

  app.get("/api/users/me/export", async (req, reply) => {
    const user = requireUser(req);
    reply.header("Content-Disposition", `attachment; filename="athanordb-${user.email}.json"`);
    return buildPersonalDataExport(user.id, req);
  });

  /**
   * Self-service account deletion. Requires the current password — this is
   * irreversible, and a session left open on someone else's machine must not
   * be enough to trigger it.
   *
   * Projects the caller owns are always left ownerless here: they may be
   * shared with a whole team, and letting a departing user hand them to an
   * arbitrary account (or take them down with them) isn't theirs to decide.
   */
  app.delete("/api/users/me", async (req, reply) => {
    const user = requireUser(req);
    const { password } = (req.body ?? {}) as { password?: string };
    if (!password) throw new ApiError("PASSWORD_REQUIRED_FOR_DELETION");
    await verifyOwnPassword(user.id, password, "PASSWORD_INCORRECT");
    if (wouldRemoveLastAdmin(user.id)) throw new ApiError("LAST_ADMIN_SELF");

    const owned = deleteUserAccount(user.id, user.email, null);
    revalidateAllRooms();
    clearSessionCookie(reply);
    auditUser(
      user,
      "user.delete",
      { type: "user", id: user.id },
      `self-service; ${owned} project(s) left ownerless`,
      req,
    );
    return { deleted: true, projectsAffected: owned };
  });

  // Self-service: requires the current password, unlike the admin reset.
  app.patch("/api/users/me/password", async (req) => {
    const user = requireUser(req);
    const { currentPassword, newPassword } = (req.body ?? {}) as { currentPassword?: string; newPassword?: string };
    if (!currentPassword || !newPassword) throw new ApiError("PASSWORDS_REQUIRED");

    const check = checkPassword(newPassword, "newPassword");
    if (!check.ok) throw new ApiError("PASSWORD_TOO_WEAK", { message: check.error });

    await verifyOwnPassword(user.id, currentPassword, "CURRENT_PASSWORD_INCORRECT");
    updatePasswordHash(user.id, await hashPassword(check.password));
    return { changed: true };
  });
}
