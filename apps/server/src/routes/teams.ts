import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { auditUser } from "../audit.js";
import { requireAdmin, requireUser } from "../auth/session.js";
import { revalidateAllRooms } from "../yjs/room.js";

interface TeamRow {
  id: string;
  name: string;
  created_at: string;
}

interface MemberRow {
  id: string;
  email: string;
  is_admin: number;
  display_name: string | null;
}

function memberSummary(row: MemberRow) {
  return {
    id: row.id,
    email: row.email,
    isAdmin: row.is_admin === 1,
    displayName: row.display_name?.trim() || row.email.split("@")[0],
  };
}

export function registerTeamRoutes(app: FastifyInstance): void {
  // Any authenticated user (not admin-only) — a non-global-admin project
  // owner/administrator needs to pick an existing team to assign to their
  // own project without being a global admin themselves.
  app.get("/api/teams", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const rows = db
      .prepare(
        `SELECT t.id, t.name, t.created_at, COUNT(tm.user_id) AS member_count
         FROM teams t LEFT JOIN team_members tm ON tm.team_id = t.id
         GROUP BY t.id ORDER BY t.name ASC`,
      )
      .all() as (TeamRow & { member_count: number })[];
    return rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at, memberCount: row.member_count }));
  });

  app.get("/api/teams/:id", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const { id } = req.params as { id: string };
    const team = db.prepare("SELECT id, name, created_at FROM teams WHERE id = ?").get(id) as TeamRow | undefined;
    if (!team) {
      reply.code(404);
      return { error: "not found" };
    }
    const members = db
      .prepare(
        `SELECT u.id, u.email, u.is_admin, u.display_name
         FROM team_members tm JOIN users u ON u.id = tm.user_id
         WHERE tm.team_id = ? ORDER BY u.email ASC`,
      )
      .all(id) as MemberRow[];
    return { id: team.id, name: team.name, createdAt: team.created_at, members: members.map(memberSummary) };
  });

  app.post("/api/teams", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const { name } = (req.body ?? {}) as { name?: string };
    const trimmed = name?.trim();
    if (!trimmed) {
      reply.code(400);
      return { error: "name is required" };
    }
    if (trimmed.length > 200) {
      reply.code(400);
      return { error: "name must be 200 characters or fewer" };
    }
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO teams (id, name) VALUES (?, ?)").run(id, trimmed);
    auditUser(admin, "team.create", { type: "team", id }, trimmed, req);
    return reply.code(201).send({ id, name: trimmed, memberCount: 0 });
  });

  app.patch("/api/teams/:id", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const { id } = req.params as { id: string };
    if (!db.prepare("SELECT 1 FROM teams WHERE id = ?").get(id)) {
      reply.code(404);
      return { error: "not found" };
    }
    const { name } = (req.body ?? {}) as { name?: string };
    const trimmed = name?.trim();
    if (!trimmed) {
      reply.code(400);
      return { error: "name is required" };
    }
    db.prepare("UPDATE teams SET name = ? WHERE id = ?").run(trimmed, id);
    return { id, name: trimmed };
  });

  app.delete("/api/teams/:id", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const { id } = req.params as { id: string };
    if (!db.prepare("SELECT 1 FROM teams WHERE id = ?").get(id)) {
      reply.code(404);
      return { error: "not found" };
    }
    // No FK cascade in this SQLite setup — delete dependents first, same
    // ordering the project hard-delete route already uses.
    const deleteTeam = db.transaction((teamId: string) => {
      db.prepare("DELETE FROM project_teams WHERE team_id = ?").run(teamId);
      db.prepare("DELETE FROM team_members WHERE team_id = ?").run(teamId);
      db.prepare("DELETE FROM teams WHERE id = ?").run(teamId);
    });
    deleteTeam(id);
    auditUser(admin, "team.delete", { type: "team", id }, undefined, req);
    // Every project this team granted access to just lost that grant, and a
    // project whose *only* team was this one flips back from restricted to
    // open — both change what open sockets may do, on projects that aren't
    // cheap to enumerate from here.
    revalidateAllRooms();
    return { deleted: true };
  });

  app.post("/api/teams/:id/members", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const { id } = req.params as { id: string };
    if (!db.prepare("SELECT 1 FROM teams WHERE id = ?").get(id)) {
      reply.code(404);
      return { error: "not found" };
    }
    const { userId } = (req.body ?? {}) as { userId?: string };
    if (!userId || !db.prepare("SELECT 1 FROM users WHERE id = ?").get(userId)) {
      reply.code(400);
      return { error: "a valid userId is required" };
    }
    db.prepare("INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)").run(id, userId);
    revalidateAllRooms();
    auditUser(admin, "team.member.add", { type: "team", id }, `user ${userId}`, req);
    return { added: true };
  });

  app.delete("/api/teams/:id/members/:userId", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const { id, userId } = req.params as { id: string; userId: string };
    db.prepare("DELETE FROM team_members WHERE team_id = ? AND user_id = ?").run(id, userId);
    auditUser(admin, "team.member.remove", { type: "team", id }, `user ${userId}`, req);
    // The removed member may be connected right now to any project this team
    // granted — those sockets get closed by the re-check rather than keeping
    // the access they joined with.
    revalidateAllRooms();
    return { removed: true };
  });
}
