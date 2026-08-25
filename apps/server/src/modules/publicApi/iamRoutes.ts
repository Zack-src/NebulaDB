import type { FastifyInstance } from "fastify";
import { requireScope } from "../apiKeys/auth.js";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireProjectAccess, requireProjectAdmin } from "../../shared/guards.js";
import { revalidateRoom } from "../../realtime/roomRegistry.js";
import { isPermissionLevel } from "../../shared/permissions.js";
import { grantTeamPermission, listProjectTeams, revokeTeamPermission, teamExists } from "../projects/repository.js";
import { API_RATE_LIMIT } from "./rateLimits.js";

/** IAM: which teams can access a project, at what level (`project_teams` grants — see `shared/permissions.ts`). */
export function registerPublicIamRoutes(app: FastifyInstance): void {
  app.get("/api/v1/projects/:id/iam", API_RATE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    requireProjectAccess(req, id, "view");
    requireScope(req, "projects:read", id);
    return { teams: listProjectTeams(id) };
  });

  app.put("/api/v1/projects/:id/iam/:teamId", API_RATE_LIMIT, async (req) => {
    const { id, teamId } = req.params as { id: string; teamId: string };
    const { user } = requireProjectAdmin(req, id);
    requireScope(req, "projects:write", id);
    if (!teamExists(teamId)) throw new ApiError("TEAM_NOT_FOUND");

    const { permission } = (req.body ?? {}) as { permission?: string };
    if (!isPermissionLevel(permission)) throw new ApiError("PERMISSION_INVALID");

    grantTeamPermission(id, teamId, permission);
    // Sockets already open on this project resolved their access when they connected;
    // without this, a permission change wouldn't reach them until the room's own re-check interval.
    revalidateRoom(id);
    auditUser(user, "project.team.grant", { type: "project", id }, `team ${teamId} -> ${permission} (v1)`, req);
    return { projectId: id, teamId, permission };
  });

  app.delete("/api/v1/projects/:id/iam/:teamId", API_RATE_LIMIT, async (req) => {
    const { id, teamId } = req.params as { id: string; teamId: string };
    const { user } = requireProjectAdmin(req, id);
    requireScope(req, "projects:write", id);
    revokeTeamPermission(id, teamId);
    revalidateRoom(id);
    auditUser(user, "project.team.revoke", { type: "project", id }, `team ${teamId} (v1)`, req);
    return { removed: true };
  });
}
