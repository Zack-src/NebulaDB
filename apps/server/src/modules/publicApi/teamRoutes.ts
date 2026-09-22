import type { FastifyInstance } from "fastify";
import { requireGlobalScope } from "../apiKeys/auth.js";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin, requireUser } from "../../shared/guards.js";
import { revalidateAllRooms } from "../../realtime/roomRegistry.js";
import {
  addTeamMember,
  deleteTeamCascade,
  getTeam,
  insertTeam,
  listTeamMembers,
  listTeamsWithMemberCount,
  removeTeamMember,
  updateTeamName,
  userExists,
  type TeamMemberRow,
} from "../teams/repository.js";
import { API_RATE_LIMIT } from "./rateLimits.js";

const MAX_TEAM_NAME_LENGTH = 200;

function toMemberSummary(row: TeamMemberRow) {
  return {
    id: row.id,
    email: row.email,
    isAdmin: row.is_admin === 1,
    displayName: row.display_name?.trim() || row.email.split("@")[0],
  };
}

function parseTeamName(name: unknown): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) throw new ApiError("NAME_REQUIRED");
  if (trimmed.length > MAX_TEAM_NAME_LENGTH) throw new ApiError("NAME_TOO_LONG");
  return trimmed;
}

function requireTeam(id: string) {
  const team = getTeam(id);
  if (!team) throw new ApiError("NOT_FOUND");
  return team;
}

/**
 * Team CRUD and membership — instance-wide, global-admin-only, same as the
 * internal `modules/teams/routes.ts` this mirrors. Not project-scoped, so
 * these use `requireGlobalScope` (`teams:manage`) rather than `requireScope`:
 * a project-restricted key is refused outright, not just unscoped-checked.
 */
export function registerPublicTeamRoutes(app: FastifyInstance): void {
  app.get("/api/v1/teams", API_RATE_LIMIT, async (req) => {
    requireUser(req);
    requireGlobalScope(req, "teams:manage");
    return {
      teams: listTeamsWithMemberCount().map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        memberCount: row.member_count,
      })),
    };
  });

  app.get("/api/v1/teams/:id", API_RATE_LIMIT, async (req) => {
    requireAdmin(req);
    requireGlobalScope(req, "teams:manage");
    const { id } = req.params as { id: string };
    const team = requireTeam(id);
    return {
      id: team.id,
      name: team.name,
      createdAt: team.created_at,
      members: listTeamMembers(id).map(toMemberSummary),
    };
  });

  app.post("/api/v1/teams", API_RATE_LIMIT, async (req, reply) => {
    const admin = requireAdmin(req);
    requireGlobalScope(req, "teams:manage");
    const name = parseTeamName((req.body as { name?: unknown } | undefined)?.name);
    const id = crypto.randomUUID();
    insertTeam(id, name);
    auditUser(admin, "team.create", { type: "team", id }, `${name} (v1)`, req);
    return reply.code(201).send({ id, name, memberCount: 0 });
  });

  app.patch("/api/v1/teams/:id", API_RATE_LIMIT, async (req) => {
    requireAdmin(req);
    requireGlobalScope(req, "teams:manage");
    const { id } = req.params as { id: string };
    requireTeam(id);
    const name = parseTeamName((req.body as { name?: unknown } | undefined)?.name);
    updateTeamName(id, name);
    return { id, name };
  });

  app.delete("/api/v1/teams/:id", API_RATE_LIMIT, async (req) => {
    const admin = requireAdmin(req);
    requireGlobalScope(req, "teams:manage");
    const { id } = req.params as { id: string };
    requireTeam(id);
    deleteTeamCascade(id);
    auditUser(admin, "team.delete", { type: "team", id }, "v1", req);
    // Every project this team granted access to just lost that grant, and a
    // project whose *only* team was this one flips back from restricted to
    // open — both change what open sockets may do, on projects that aren't
    // cheap to enumerate from here.
    revalidateAllRooms();
    return { deleted: true };
  });

  app.post("/api/v1/teams/:id/members", API_RATE_LIMIT, async (req) => {
    const admin = requireAdmin(req);
    requireGlobalScope(req, "teams:manage");
    const { id } = req.params as { id: string };
    requireTeam(id);
    const { userId } = (req.body ?? {}) as { userId?: string };
    if (!userId || !userExists(userId)) throw new ApiError("USER_ID_INVALID");
    addTeamMember(id, userId);
    revalidateAllRooms();
    auditUser(admin, "team.member.add", { type: "team", id }, `user ${userId} (v1)`, req);
    return { added: true };
  });

  app.delete("/api/v1/teams/:id/members/:userId", API_RATE_LIMIT, async (req) => {
    const admin = requireAdmin(req);
    requireGlobalScope(req, "teams:manage");
    const { id, userId } = req.params as { id: string; userId: string };
    removeTeamMember(id, userId);
    auditUser(admin, "team.member.remove", { type: "team", id }, `user ${userId} (v1)`, req);
    // The removed member may be connected right now to any project this team
    // granted — those sockets get closed by the re-check rather than keeping
    // the access they joined with.
    revalidateAllRooms();
    return { removed: true };
  });
}
