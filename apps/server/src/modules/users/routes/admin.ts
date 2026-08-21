import type { FastifyInstance } from "fastify";
import { auditUser } from "../../../shared/audit.js";
import { checkPassword, hashPassword } from "../../auth/password.js";
import { ApiError } from "../../../shared/errors.js";
import { requireAdmin } from "../../../shared/guards.js";
import { revalidateAllRooms } from "../../../realtime/roomRegistry.js";
import {
  deleteUserSessions,
  disableUser,
  enableUser,
  getUserIdentity,
  listUsers,
  updatePasswordHash,
  userExists,
  type UserIdentityRow,
} from "../repository.js";
import { deleteUserAccount, toUserSummary, wouldRemoveLastAdmin } from "../service.js";

function requireTargetUser(id: string): UserIdentityRow {
  const target = getUserIdentity(id);
  if (!target) throw new ApiError("NOT_FOUND");
  return target;
}

/** Routes an administrator uses to act on *other* accounts. */
export function registerUserAdminRoutes(app: FastifyInstance): void {
  // Needed by the Teams admin-console member picker as well as the user
  // administration UI behind the routes below.
  app.get("/api/users", async (req) => {
    requireAdmin(req);
    return listUsers().map(toUserSummary);
  });

  // Admin override — no current-password check, since the whole point is
  // recovering a user who can't provide one. Kills every existing session for
  // that account so the old password can't keep being used anywhere it's
  // still logged in.
  app.patch("/api/users/:id/password", async (req) => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    if (!userExists(id)) throw new ApiError("NOT_FOUND");

    const { newPassword } = (req.body ?? {}) as { newPassword?: string };
    const check = checkPassword(newPassword, "newPassword");
    if (!check.ok) throw new ApiError("PASSWORD_TOO_WEAK", { message: check.error });

    updatePasswordHash(id, await hashPassword(check.password));
    deleteUserSessions(id);
    auditUser(admin, "user.password.reset", { type: "user", id }, undefined, req);
    return { reset: true };
  });

  /**
   * Disable / re-enable an account — the offboarding path. Disabling is
   * deliberately the reversible option and the one the UI leads with; DELETE
   * below is for when the account must actually go away.
   */
  app.patch("/api/users/:id/disabled", async (req) => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    const target = requireTargetUser(id);

    const { disabled } = (req.body ?? {}) as { disabled?: boolean };
    if (typeof disabled !== "boolean") throw new ApiError("DISABLED_MUST_BE_BOOLEAN");
    if (disabled && id === admin.id) throw new ApiError("CANNOT_DISABLE_SELF");
    if (disabled && wouldRemoveLastAdmin(id)) throw new ApiError("LAST_ADMIN");

    if (disabled) {
      disableUser(id);
      // Any WebSocket they still hold open resolves its access again and is
      // closed — `resolveSession` now refuses disabled accounts, but a socket
      // authenticated before the change is already past that check.
      revalidateAllRooms();
    } else {
      enableUser(id);
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
   * readable by every logged-in user and manageable by global admins, and
   * there is currently no route to re-assign one — so the transfer option is
   * the way to avoid a one-way door.
   */
  app.delete("/api/users/:id", async (req) => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    const target = requireTargetUser(id);
    if (id === admin.id) throw new ApiError("CANNOT_DELETE_SELF");
    if (wouldRemoveLastAdmin(id)) throw new ApiError("LAST_ADMIN");

    const { transferProjectsTo } = (req.body ?? {}) as { transferProjectsTo?: string };
    if (transferProjectsTo !== undefined && (transferProjectsTo === id || !userExists(transferProjectsTo))) {
      throw new ApiError("TRANSFER_TARGET_INVALID");
    }

    const owned = deleteUserAccount(id, target.email, transferProjectsTo ?? null);
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
