import type { FastifyInstance } from "fastify";
import type { MyDbAccess, UserDbAccess } from "@nebuladb/shared";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin, requireUser } from "../../shared/guards.js";
import { getTeam, listTeamMembers } from "../teams/repository.js";
import { db } from "../../infrastructure/db.js";
import { provisionAccounts } from "./provision.js";
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
 * The console routes that honour these grants are in `dbAdmin/explorerRoutes.ts`
 * (`/api/connections/:id/…`).
 */
export function registerDbAccessRoutes(app: FastifyInstance): void {
  app.post("/api/admin/teams/:id/db-accounts", WRITE_LIMIT, async (req) => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    if (!(await getTeam(id))) throw new ApiError("NOT_FOUND");
    const entries = (await getTeamDbAccess(id)).map((g) => ({ connectionId: g.connectionId, level: g.level }));
    const users = await listTeamMembers(id);
    if (users.length * entries.length > 500)
      throw new ApiError("DB_ADMIN_INPUT_INVALID", { message: "at most 500 accounts per batch" });
    return { results: await provisionAccounts(admin, users, entries) };
  });
  app.post("/api/admin/users/:id/db-accounts", WRITE_LIMIT, async (req) => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    const user = (await db.prepare("SELECT id, email FROM users WHERE id = ?").get(id)) as
      { id: string; email: string } | undefined;
    if (!user) throw new ApiError("NOT_FOUND");
    const access = await getUserDbAccess(id);
    const entries = [...access.grants, ...access.inherited].filter((g) => g.level);
    const unique = [...new Map(entries.map((g) => [g.connectionId, g])).values()];
    return { results: await provisionAccounts(admin, [user], unique) };
  });
  // The connections the caller may query — how the workspace knows to offer "Données & SQL".
  app.get("/api/me/db-access", READ_LIMIT, async (req): Promise<MyDbAccess> => {
    const user = requireUser(req);
    if (req.apiKey) return { connections: [] };
    return { connections: await listAccessibleConnections(user.id) };
  });

  app.get("/api/admin/users/:id/db-access", READ_LIMIT, async (req): Promise<UserDbAccess> => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    if (!(await userExists(id))) throw new ApiError("NOT_FOUND");
    return await getUserDbAccess(id);
  });

  // Replaces the user's own grants and database account names; what their teams give is untouched.
  app.put("/api/admin/users/:id/db-access", WRITE_LIMIT, async (req): Promise<UserDbAccess> => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    if (!(await userExists(id))) throw new ApiError("NOT_FOUND");
    const entries = await parseGrantEntries((req.body as { grants?: unknown } | undefined)?.grants, true);
    await replaceUserGrants(id, entries, admin.id);
    await auditUser(admin, "dbaccess.user.set", { type: "user", id }, await describeGrants(entries), req);
    return await getUserDbAccess(id);
  });

  app.get("/api/admin/teams/:id/db-access", READ_LIMIT, async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    if (!(await getTeam(id))) throw new ApiError("NOT_FOUND");
    return { grants: await getTeamDbAccess(id) };
  });

  app.put("/api/admin/teams/:id/db-access", WRITE_LIMIT, async (req) => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    if (!(await getTeam(id))) throw new ApiError("NOT_FOUND");
    const entries = await parseGrantEntries((req.body as { grants?: unknown } | undefined)?.grants, false);
    await replaceTeamGrants(id, entries, admin.id);
    await auditUser(admin, "dbaccess.team.set", { type: "team", id }, await describeGrants(entries), req);
    return { grants: await getTeamDbAccess(id) };
  });
}
