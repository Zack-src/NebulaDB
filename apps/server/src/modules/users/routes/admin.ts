import type { FastifyInstance } from "fastify";
import { auditUser } from "../../../shared/audit.js";
import { checkPassword, hashPassword } from "../../auth/password.js";
import { CREDENTIAL_RATE_LIMIT } from "../../auth/rateLimits.js";
import { ApiError } from "../../../shared/errors.js";
import { requireAdmin } from "../../../shared/guards.js";
import { revalidateAllRooms } from "../../../realtime/roomRegistry.js";
import {
  deleteUserSessions,
  disableUser,
  enableUser,
  getUserIdentity,
  isAdminUser,
  listTeamMembershipsOf,
  listUsers,
  setUserAdmin,
  updatePasswordHash,
  userExists,
  type UserIdentityRow,
} from "../repository.js";
import { deleteUserAccount, toUserSummary, unlessLastAdmin } from "../service.js";
import { listUserProjects } from "../../projects/repository.js";
import { idParams, parseBody, parseParams, z } from "../../../shared/validate.js";

// Fields with dedicated error codes (PASSWORD_TOO_WEAK, DISABLED_MUST_BE_BOOLEAN, ...) stay `unknown`.
const resetPasswordBody = z.object({ newPassword: z.unknown().optional() });
const disabledBody = z.object({ disabled: z.unknown().optional() });
const adminBody = z.object({ admin: z.unknown().optional() });
const deleteBody = z.object({ transferProjectsTo: z.string().optional() });

async function requireTargetUser(id: string): Promise<UserIdentityRow> {
  const target = await getUserIdentity(id);
  if (!target) throw new ApiError("NOT_FOUND");
  return target;
}

/** Routes an administrator uses to act on *other* accounts. */
export function registerUserAdminRoutes(app: FastifyInstance): void {
  // Needed by the Teams admin-console member picker as well as the user
  // administration UI behind the routes below.
  app.get("/api/users", async (req) => {
    requireAdmin(req);
    return (await listUsers()).map(toUserSummary);
  });

  // What one person can reach, on one screen: their teams, and the projects
  // they own or were given a level on themselves.
  app.get("/api/users/:id/access", async (req) => {
    requireAdmin(req);
    const { id } = parseParams(idParams, req);
    await requireTargetUser(id);
    return { teams: await listTeamMembershipsOf(id), projects: await listUserProjects(id) };
  });

  // Admin override — no current-password check, since the whole point is
  // recovering a user who can't provide one. Kills every existing session for
  // that account so the old password can't keep being used anywhere it's
  // still logged in.
  app.patch("/api/users/:id/password", CREDENTIAL_RATE_LIMIT, async (req) => {
    const admin = requireAdmin(req);
    const { id } = parseParams(idParams, req);
    if (!(await userExists(id))) throw new ApiError("NOT_FOUND");

    const { newPassword } = parseBody(resetPasswordBody, req);
    const check = checkPassword(newPassword, "newPassword");
    if (!check.ok) throw new ApiError("PASSWORD_TOO_WEAK", { message: check.error });

    await updatePasswordHash(id, await hashPassword(check.password));
    await deleteUserSessions(id);
    await auditUser(admin, "user.password.reset", { type: "user", id }, undefined, req);
    return { reset: true };
  });

  /**
   * Disable / re-enable an account — the offboarding path. Disabling is
   * deliberately the reversible option and the one the UI leads with; DELETE
   * below is for when the account must actually go away.
   */
  app.patch("/api/users/:id/disabled", async (req) => {
    const admin = requireAdmin(req);
    const { id } = parseParams(idParams, req);
    const target = await requireTargetUser(id);

    const { disabled } = parseBody(disabledBody, req);
    if (typeof disabled !== "boolean") throw new ApiError("DISABLED_MUST_BE_BOOLEAN");
    if (disabled && id === admin.id) throw new ApiError("CANNOT_DISABLE_SELF");

    if (disabled) {
      await unlessLastAdmin(id, "LAST_ADMIN", () => disableUser(id));
      // Any WebSocket they still hold open resolves its access again and is
      // closed — `resolveSession` now refuses disabled accounts, but a socket
      // authenticated before the change is already past that check.
      await revalidateAllRooms();
    } else {
      await enableUser(id);
    }
    await auditUser(admin, disabled ? "user.disable" : "user.enable", { type: "user", id }, target.email, req);
    return { id, disabled };
  });

  /**
   * Make an account an instance administrator, or take the role back.
   *
   * Browser session only: an administrator's API key that could mint other
   * administrators would turn one leaked key into a standing way in. Nobody
   * takes their own role away — which also means there is always one left:
   * the caller.
   */
  app.patch("/api/users/:id/admin", async (req) => {
    const admin = requireAdmin(req);
    if (req.apiKey) throw new ApiError("FORBIDDEN");
    const { id } = parseParams(idParams, req);
    const target = await requireTargetUser(id);

    const parsed = parseBody(adminBody, req);
    if (typeof parsed.admin !== "boolean") throw new ApiError("ADMIN_MUST_BE_BOOLEAN");
    const body = { admin: parsed.admin };
    if (!body.admin && id === admin.id) throw new ApiError("CANNOT_DEMOTE_SELF");

    if ((await isAdminUser(id)) !== body.admin) {
      if (body.admin) await setUserAdmin(id, true);
      else await unlessLastAdmin(id, "LAST_ADMIN", () => setUserAdmin(id, false));
      // What they may open changed with the role: sockets held open resolve their access again.
      await revalidateAllRooms();
      await auditUser(admin, body.admin ? "user.promote" : "user.demote", { type: "user", id }, target.email, req);
    }
    return { id, admin: body.admin };
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
    const { id } = parseParams(idParams, req);
    const target = await requireTargetUser(id);
    if (id === admin.id) throw new ApiError("CANNOT_DELETE_SELF");

    const { transferProjectsTo } = parseBody(deleteBody, req);
    if (transferProjectsTo !== undefined && (transferProjectsTo === id || !(await userExists(transferProjectsTo)))) {
      throw new ApiError("TRANSFER_TARGET_INVALID");
    }

    const owned = await unlessLastAdmin(id, "LAST_ADMIN", () =>
      deleteUserAccount(id, target.email, transferProjectsTo ?? null),
    );
    await revalidateAllRooms();
    await auditUser(
      admin,
      "user.delete",
      { type: "user", id },
      `${target.email}; ${owned} project(s) ${transferProjectsTo ? "transferred" : "left ownerless"}`,
      req,
    );
    return { deleted: true, projectsAffected: owned, transferred: Boolean(transferProjectsTo) };
  });
}
