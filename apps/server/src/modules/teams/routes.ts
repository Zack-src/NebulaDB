import type { FastifyInstance } from "fastify";
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
} from "./repository.js";

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

/** Resolves a team id or refuses — every admin route below starts with this. */
function requireTeam(id: string) {
  const team = getTeam(id);
  if (!team) throw new ApiError("NOT_FOUND");
  return team;
}

export function registerTeamRoutes(app: FastifyInstance): void {
  // Any authenticated user (not admin-only) — a non-global-admin project
  // owner/administrator needs to pick an existing team to assign to their
  // own project without being a global admin themselves.
  app.get("/api/teams", async (req) => {
    requireUser(req);
    return listTeamsWithMemberCount().map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      memberCount: row.member_count,
    }));
  });

  app.get("/api/teams/:id", async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const team = requireTeam(id);
    return {
      id: team.id,
      name: team.name,
      createdAt: team.created_at,
      members: listTeamMembers(id).map(toMemberSummary),
    };
  });

  app.post("/api/teams", async (req, reply) => {
    const admin = requireAdmin(req);
    const name = parseTeamName((req.body as { name?: unknown } | undefined)?.name);
    const id = crypto.randomUUID();
    insertTeam(id, name);
    auditUser(admin, "team.create", { type: "team", id }, name, req);
    return reply.code(201).send({ id, name, memberCount: 0 });
  });

  app.patch("/api/teams/:id", async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    requireTeam(id);
    const name = parseTeamName((req.body as { name?: unknown } | undefined)?.name);
    updateTeamName(id, name);
    return { id, name };
  });

  app.delete("/api/teams/:id", async (req) => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    requireTeam(id);
    deleteTeamCascade(id);
    auditUser(admin, "team.delete", { type: "team", id }, undefined, req);
    // Every project this team granted access to just lost that grant, and a
    // project whose *only* team was this one flips back from restricted to
    // open — both change what open sockets may do, on projects that aren't
    // cheap to enumerate from here.
    revalidateAllRooms();
    return { deleted: true };
  });

  app.post("/api/teams/:id/members", async (req) => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    requireTeam(id);
    const { userId } = (req.body ?? {}) as { userId?: string };
    if (!userId || !userExists(userId)) throw new ApiError("USER_ID_INVALID");
    addTeamMember(id, userId);
    revalidateAllRooms();
    auditUser(admin, "team.member.add", { type: "team", id }, `user ${userId}`, req);
    return { added: true };
  });

  app.delete("/api/teams/:id/members/:userId", async (req) => {
    const admin = requireAdmin(req);
    const { id, userId } = req.params as { id: string; userId: string };
    removeTeamMember(id, userId);
    auditUser(admin, "team.member.remove", { type: "team", id }, `user ${userId}`, req);
    // The removed member may be connected right now to any project this team
    // granted — those sockets get closed by the re-check rather than keeping
    // the access they joined with.
    revalidateAllRooms();
    return { removed: true };
  });
}
