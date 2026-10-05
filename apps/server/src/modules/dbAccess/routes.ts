import type { FastifyInstance } from "fastify";
import type { MyDbAccess, UserDbAccess } from "@athanordb/shared";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin, requireUser } from "../../shared/guards.js";
import { getTeam } from "../teams/repository.js";
import { userExists } from "../users/repository.js";
import {
  getTeamDbAccess,
  getUserDbAccess,
  listAccessibleConnections,
  replaceTeamGrants,
  replaceUserGrants,
} from "./repository.js";
import { describeGrants, parseGrantEntries } from "./service.js";

const READ_LIMIT = { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } };
const WRITE_LIMIT = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };

/**
 * Database access for members: who may use the explorer and SQL of which
 * connection, granted by an instance administrator to a user or a team.
 * The console routes that honour these grants are in `dbAdmin/routes.ts`
 * (`/api/connections/:id/…`).
 */
export function registerDbAccessRoutes(app: FastifyInstance): void {
  // The connections the caller may query — how the workspace knows to offer "Données & SQL".
  app.get("/api/me/db-access", READ_LIMIT, async (req): Promise<MyDbAccess> => {
    const user = requireUser(req);
    if (req.apiKey) return { connections: [] };
    return { connections: listAccessibleConnections(user.id) };
  });

  app.get("/api/admin/users/:id/db-access", READ_LIMIT, async (req): Promise<UserDbAccess> => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    if (!userExists(id)) throw new ApiError("NOT_FOUND");
    return getUserDbAccess(id);
  });

  // Replaces the user's own grants and database account names; what their teams give is untouched.
  app.put("/api/admin/users/:id/db-access", WRITE_LIMIT, async (req): Promise<UserDbAccess> => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    if (!userExists(id)) throw new ApiError("NOT_FOUND");
    const entries = parseGrantEntries((req.body as { grants?: unknown } | undefined)?.grants, true);
    replaceUserGrants(id, entries, admin.id);
    auditUser(admin, "dbaccess.user.set", { type: "user", id }, describeGrants(entries), req);
    return getUserDbAccess(id);
  });

  app.get("/api/admin/teams/:id/db-access", READ_LIMIT, async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    if (!getTeam(id)) throw new ApiError("NOT_FOUND");
    return { grants: getTeamDbAccess(id) };
  });

  app.put("/api/admin/teams/:id/db-access", WRITE_LIMIT, async (req) => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    if (!getTeam(id)) throw new ApiError("NOT_FOUND");
    const entries = parseGrantEntries((req.body as { grants?: unknown } | undefined)?.grants, false);
    replaceTeamGrants(id, entries, admin.id);
    auditUser(admin, "dbaccess.team.set", { type: "team", id }, describeGrants(entries), req);
    return { grants: getTeamDbAccess(id) };
  });
}
