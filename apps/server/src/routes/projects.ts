import type { FastifyInstance } from "fastify";
import * as Y from "yjs";
import { readProjectFromDoc, writeProjectToDoc } from "@athanordb/shared";
import {
  applyVisualMetadata,
  describeDbmlParseError,
  mergeProjectIntoExisting,
  parseDbml,
  parseSql,
  projectToDbml,
  projectToSql,
  toProject,
  type SqlDialect,
} from "@athanordb/dbml-engine";
import { auditUser } from "../audit.js";
import { db } from "../db.js";
import { requireUser } from "../auth/session.js";
import { canManageProject, getEffectivePermission, hasPermission, isPermissionLevel } from "../permissions.js";
import { listRevisions, loadSnapshot, reconstructDocAtRevision, setRevisionLabel } from "../yjs/persistence.js";
import { closeRoom, getRoom, revalidateRoom } from "../yjs/room.js";

const SQL_DIALECTS: SqlDialect[] = ["postgres", "mysql", "mssql"];

function isSqlDialect(value: unknown): value is SqlDialect {
  return typeof value === "string" && (SQL_DIALECTS as string[]).includes(value);
}

/**
 * Ceiling on projects owned by one account. An abuse backstop in the same
 * spirit as the per-project entity caps in `@athanordb/shared` — generous
 * enough that no real user meets it, low enough that a scripted loop can't
 * fill the disk with empty projects.
 */
const MAX_PROJECTS_PER_USER = 500;

type ProjectStatus = "active" | "archived" | "trashed";
const PROJECT_STATUSES: ProjectStatus[] = ["active", "archived", "trashed"];

function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === "string" && (PROJECT_STATUSES as string[]).includes(value);
}

export function getProjectRow(id: string): { id: string; name: string; owner_id: string | null } | undefined {
  return db.prepare("SELECT id, name, owner_id FROM projects WHERE id = ?").get(id) as
    | { id: string; name: string; owner_id: string | null }
    | undefined;
}

export function registerProjectRoutes(app: FastifyInstance): void {
  app.get("/api/projects", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const rows = db.prepare("SELECT id, name, status, created_at FROM projects ORDER BY created_at DESC").all() as {
      id: string;
      name: string;
      status: ProjectStatus;
      created_at: string;
    }[];
    return rows
      .map((row) => ({ ...row, permission: getEffectivePermission(user.id, row.id) }))
      .filter((row) => row.permission !== null);
  });

  app.post("/api/projects", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
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
    // Entity counts *inside* a project have been capped since Phase 13; the
    // number of projects one account can create was not, so a single logged-in
    // user could fill the disk a project at a time. Trashed projects still
    // count — they are recoverable, so they still occupy the quota — but this
    // is an abuse ceiling, not a plan limit, and it is far above any real use.
    const owned = db.prepare("SELECT COUNT(*) AS n FROM projects WHERE owner_id = ?").get(user.id) as { n: number };
    if (owned.n >= MAX_PROJECTS_PER_USER) {
      reply.code(409);
      return { error: `you have reached the limit of ${MAX_PROJECTS_PER_USER} projects` };
    }
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO projects (id, name, owner_id) VALUES (?, ?, ?)").run(id, trimmed, user.id);
    auditUser(user, "project.create", { type: "project", id }, trimmed, req);
    return reply.code(201).send({ id, name: trimmed, permission: "administrator" });
  });

  app.get("/api/projects/:id", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const project = db.prepare("SELECT id, name, status, created_at FROM projects WHERE id = ?").get(id);
    if (!project) {
      reply.code(404);
      return { error: "not found" };
    }
    const permission = getEffectivePermission(user.id, id);
    if (!permission) {
      reply.code(403);
      return { error: "forbidden" };
    }
    return { ...project, permission };
  });

  // Handles both renaming and archive/trash/restore transitions — a project
  // card action only ever changes one or the other, but there's no reason to
  // split them into two endpoints.
  app.patch("/api/projects/:id", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    if (!getProjectRow(id)) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!canManageProject(user.id, id)) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const { name, status } = (req.body ?? {}) as { name?: string; status?: string };
    if (name === undefined && status === undefined) {
      reply.code(400);
      return { error: "name or status is required" };
    }
    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed) {
        reply.code(400);
        return { error: "name is required" };
      }
      if (trimmed.length > 200) {
        reply.code(400);
        return { error: "name must be 200 characters or fewer" };
      }
      db.prepare("UPDATE projects SET name = ? WHERE id = ?").run(trimmed, id);
    }
    if (status !== undefined) {
      if (!isProjectStatus(status)) {
        reply.code(400);
        return { error: `status must be one of ${PROJECT_STATUSES.join(", ")}` };
      }
      db.prepare("UPDATE projects SET status = ? WHERE id = ?").run(status, id);
      // Only the destructive-ish transitions are worth a row: renames are
      // already visible in the project itself, but "who trashed this?" is a
      // question that gets asked after the fact.
      if (status === "trashed" || status === "archived") {
        auditUser(user, "project.archive", { type: "project", id }, `status set to ${status}`, req);
      } else {
        auditUser(user, "project.restore", { type: "project", id }, `status set to ${status}`, req);
      }
    }
    const row = db.prepare("SELECT id, name, status, created_at FROM projects WHERE id = ?").get(id) as {
      id: string;
      name: string;
      status: ProjectStatus;
      created_at: string;
    };
    return { ...row, permission: "administrator" as const };
  });

  // Permanent delete — the client only calls this from the Trash section
  // ("delete forever"). Moving a project to trash is just a status update via
  // PATCH above, so it can be restored; this one can't be undone.
  app.delete("/api/projects/:id", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    if (!getProjectRow(id)) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!canManageProject(user.id, id)) {
      reply.code(403);
      return { error: "forbidden" };
    }
    // Stop the in-memory room (if live) before touching its rows, so a
    // concurrent editor can't write a revision/snapshot for an id that's
    // about to stop existing.
    closeRoom(id);
    const name = getProjectRow(id)?.name;
    db.prepare("DELETE FROM project_teams WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM revisions WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM snapshots WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    // Recorded after the fact rather than before: the audit row should reflect
    // what actually happened, and the name has to be read while the row still
    // exists.
    auditUser(user, "project.delete", { type: "project", id }, name, req);
    return { deleted: true };
  });

  app.get("/api/projects/:id/teams", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    if (!getProjectRow(id)) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!hasPermission(user.id, id, "view")) {
      reply.code(403);
      return { error: "forbidden" };
    }
    return db
      .prepare(
        `SELECT pt.team_id AS teamId, t.name AS teamName, pt.permission AS permission
         FROM project_teams pt JOIN teams t ON t.id = pt.team_id
         WHERE pt.project_id = ?
         ORDER BY t.name ASC`,
      )
      .all(id);
  });

  app.put("/api/projects/:id/teams/:teamId", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id, teamId } = req.params as { id: string; teamId: string };
    if (!getProjectRow(id)) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!canManageProject(user.id, id)) {
      reply.code(403);
      return { error: "forbidden" };
    }
    if (!db.prepare("SELECT 1 FROM teams WHERE id = ?").get(teamId)) {
      reply.code(404);
      return { error: "no such team" };
    }
    const { permission } = (req.body ?? {}) as { permission?: string };
    if (!isPermissionLevel(permission)) {
      reply.code(400);
      return { error: "permission must be one of view, edit, administrator" };
    }
    db.prepare(
      `INSERT INTO project_teams (project_id, team_id, permission) VALUES (?, ?, ?)
       ON CONFLICT(project_id, team_id) DO UPDATE SET permission = excluded.permission`,
    ).run(id, teamId, permission);
    // Sockets already open on this project resolved their access when they
    // connected; without this, a downgrade to `view` (or a first grant that
    // restricts a previously-open project) wouldn't reach them for up to the
    // room's re-check interval.
    revalidateRoom(id);
    auditUser(user, "project.team.grant", { type: "project", id }, `team ${teamId} -> ${permission}`, req);
    return { projectId: id, teamId, permission };
  });

  app.delete("/api/projects/:id/teams/:teamId", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id, teamId } = req.params as { id: string; teamId: string };
    if (!getProjectRow(id)) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!canManageProject(user.id, id)) {
      reply.code(403);
      return { error: "forbidden" };
    }
    db.prepare("DELETE FROM project_teams WHERE project_id = ? AND team_id = ?").run(id, teamId);
    revalidateRoom(id);
    auditUser(user, "project.team.revoke", { type: "project", id }, `team ${teamId}`, req);
    return { removed: true };
  });

  app.get("/api/projects/:id/revisions", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    if (!getProjectRow(id)) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!hasPermission(user.id, id, "view")) {
      reply.code(403);
      return { error: "forbidden" };
    }
    return listRevisions(id);
  });

  app.patch("/api/projects/:id/revisions/:revisionId", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id, revisionId } = req.params as { id: string; revisionId: string };
    if (!getProjectRow(id)) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!hasPermission(user.id, id, "edit")) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const { label } = (req.body ?? {}) as { label?: string | null };
    const trimmed = typeof label === "string" ? label.trim() : null;
    const ok = setRevisionLabel(id, revisionId, trimmed && trimmed.length > 0 ? trimmed : null);
    if (!ok) {
      reply.code(404);
      return { error: "no such revision for this project" };
    }
    return { labeled: true };
  });

  app.get("/api/projects/:id/revisions/:revisionId", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id, revisionId } = req.params as { id: string; revisionId: string };
    const row = getProjectRow(id);
    if (!row) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!hasPermission(user.id, id, "view")) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const doc = reconstructDocAtRevision(id, revisionId);
    if (!doc) {
      reply.code(404);
      return { error: "no such revision for this project" };
    }
    return readProjectFromDoc(doc, row.id, row.name);
  });

  app.post("/api/projects/:id/revisions/:revisionId/restore", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id, revisionId } = req.params as { id: string; revisionId: string };
    const row = getProjectRow(id);
    if (!row) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!hasPermission(user.id, id, "edit")) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const doc = reconstructDocAtRevision(id, revisionId);
    if (!doc) {
      reply.code(404);
      return { error: "no such revision for this project" };
    }
    const project = readProjectFromDoc(doc, row.id, row.name);
    const room = getRoom(id);
    room.doc.transact(() => writeProjectToDoc(room.doc, project), user.displayName);
    auditUser(user, "project.revision.restore", { type: "project", id }, `revision ${revisionId}`, req);
    return { restored: true };
  });

  app.get("/api/projects/:id/snapshot", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const row = getProjectRow(id);
    if (!row) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!hasPermission(user.id, id, "view")) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const room = getRoom(id);
    return readProjectFromDoc(room.doc, row.id, row.name);
  });

  app.post("/api/projects/:id/snapshot/restore", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const row = getProjectRow(id);
    if (!row) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!hasPermission(user.id, id, "edit")) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const snapshot = loadSnapshot(id);
    if (!snapshot) {
      reply.code(404);
      return { error: "no snapshot saved yet" };
    }
    const room = getRoom(id);
    const snapshotDoc = new Y.Doc();
    Y.applyUpdate(snapshotDoc, snapshot);
    const project = readProjectFromDoc(snapshotDoc, row.id, row.name);
    room.doc.transact(() => writeProjectToDoc(room.doc, project), user.displayName);
    return { restored: true };
  });

  app.post("/api/projects/:id/import", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const row = getProjectRow(id);
    if (!row) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!hasPermission(user.id, id, "edit")) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const body = (req.body ?? {}) as { source?: string; dialect?: string };
    if (!body.source?.trim()) {
      reply.code(400);
      return { error: "source is required" };
    }

    let database: ReturnType<typeof parseSql>;
    if (body.dialect) {
      if (!isSqlDialect(body.dialect)) {
        reply.code(400);
        return { error: `dialect must be one of ${SQL_DIALECTS.join(", ")}` };
      }
      try {
        database = parseSql(body.source, body.dialect);
      } catch (err) {
        const info = describeDbmlParseError(err);
        reply.code(400);
        return { error: `SQL parse error: ${info.message}`, ...info };
      }
    } else {
      try {
        database = parseDbml(body.source);
      } catch (err) {
        const info = describeDbmlParseError(err);
        reply.code(400);
        return { error: `DBML parse error: ${info.message}`, ...info };
      }
    }

    const parsed = body.dialect
      ? toProject(database, row.name, body.source)
      : applyVisualMetadata(toProject(database, row.name, body.source), body.source);
    const room = getRoom(id);
    // Merge by table/field name rather than a blind overwrite, so reimporting
    // an updated schema keeps existing tables' positions/detail level instead
    // of resetting the whole layout every time.
    const existingProject = readProjectFromDoc(room.doc, row.id, row.name);
    const merged = mergeProjectIntoExisting(existingProject, parsed);
    room.doc.transact(() => writeProjectToDoc(room.doc, merged), user.displayName);
    // An import can restructure an entire schema in one call, which is the
    // kind of change someone later asks "who did that, and when?" about.
    auditUser(user, "project.import", { type: "project", id }, `${merged.tables.length} table(s)`, req);
    return { imported: true, tables: merged.tables.length };
  });

  app.get("/api/projects/:id/revisions/:revisionId/export/dbml", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id, revisionId } = req.params as { id: string; revisionId: string };
    const { visual } = req.query as { visual?: string };
    const row = getProjectRow(id);
    if (!row) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!hasPermission(user.id, id, "view")) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const doc = reconstructDocAtRevision(id, revisionId);
    if (!doc) {
      reply.code(404);
      return { error: "no such revision for this project" };
    }
    const project = readProjectFromDoc(doc, row.id, row.name);
    return reply.type("text/plain").send(projectToDbml(project, { includeVisualMetadata: visual === "1" }));
  });

  app.get("/api/projects/:id/revisions/:revisionId/export/sql", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id, revisionId } = req.params as { id: string; revisionId: string };
    const { dialect } = req.query as { dialect?: string };
    if (!isSqlDialect(dialect)) {
      reply.code(400);
      return { error: `dialect query param must be one of ${SQL_DIALECTS.join(", ")}` };
    }
    const row = getProjectRow(id);
    if (!row) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!hasPermission(user.id, id, "view")) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const doc = reconstructDocAtRevision(id, revisionId);
    if (!doc) {
      reply.code(404);
      return { error: "no such revision for this project" };
    }
    const project = readProjectFromDoc(doc, row.id, row.name);
    try {
      return reply.type("text/plain").send(projectToSql(project, dialect));
    } catch (err) {
      reply.code(400);
      return { error: `export failed: ${(err as Error).message}` };
    }
  });

  app.get("/api/projects/:id/export/dbml", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const { visual } = req.query as { visual?: string };
    const row = getProjectRow(id);
    if (!row) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!hasPermission(user.id, id, "view")) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const room = getRoom(id);
    const project = readProjectFromDoc(room.doc, row.id, row.name);
    // Exports are the exfiltration path for a schema — the one read operation
    // worth recording, since everything else a viewer does leaves the data
    // where it is.
    auditUser(user, "project.export", { type: "project", id }, "dbml", req);
    return reply.type("text/plain").send(projectToDbml(project, { includeVisualMetadata: visual === "1" }));
  });

  app.get("/api/projects/:id/export/sql", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const { dialect } = req.query as { dialect?: string };
    if (!isSqlDialect(dialect)) {
      reply.code(400);
      return { error: `dialect query param must be one of ${SQL_DIALECTS.join(", ")}` };
    }
    const row = getProjectRow(id);
    if (!row) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!hasPermission(user.id, id, "view")) {
      reply.code(403);
      return { error: "forbidden" };
    }
    const room = getRoom(id);
    const project = readProjectFromDoc(room.doc, row.id, row.name);
    auditUser(user, "project.export", { type: "project", id }, `sql/${dialect}`, req);
    try {
      return reply.type("text/plain").send(projectToSql(project, dialect));
    } catch (err) {
      reply.code(400);
      return { error: `export failed: ${(err as Error).message}` };
    }
  });
}
