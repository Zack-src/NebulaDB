import type { FastifyInstance } from "fastify";
import { readProjectFromDoc, writeProjectToDoc, type DatabaseConnectionConfig, type MigrationResolutionMap } from "@athanordb/shared";
import { diffTargetAgainstLive, generateMigrationSql } from "@athanordb/dbml-engine";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireProjectAccess, requireProjectAdmin } from "../../shared/guards.js";
import { getRoom } from "../../realtime/room.js";
import { createDatabaseDriver } from "./drivers/index.js";
import {
  deleteConnection,
  getConnectionById,
  listConnectionsByProject,
  saveConnection,
  updateConnection,
} from "./repository.js";

const VALID_ENGINES = new Set(["postgres", "mysql", "sqlite"]);

/**
 * Everything here but the list route requires project `administrator`, not
 * the `edit` a normal schema change needs. That's deliberate, not an
 * oversight: unlike editing the canvas, these routes make the *server* open
 * a connection to a host/file the caller supplies (`test`/`pull`/the
 * deployment pair) or execute arbitrary generated SQL against it
 * (`apply-deployment`) — a materially larger blast radius than anything else
 * a project `edit` grant allows today. `hostGuard.ts` and the SQLite driver's
 * own-database guard narrow *where* that can point; this narrows *who* can
 * trigger it at all.
 */
export function registerConnectionRoutes(app: FastifyInstance): void {
  // 1. List connections for a project
  app.get("/api/projects/:id/connections", async (req) => {
    const { id } = req.params as { id: string };
    requireProjectAccess(req, id, "view");
    return { connections: listConnectionsByProject(id) };
  });

  // 2. Create connection
  app.post("/api/projects/:id/connections", async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requireProjectAdmin(req, id);
    const body = (req.body ?? {}) as Omit<DatabaseConnectionConfig, "id">;

    if (!body.name?.trim()) throw new ApiError("NAME_REQUIRED");
    if (!VALID_ENGINES.has(body.engine)) throw new ApiError("CONNECTION_ENGINE_INVALID");

    const saved = saveConnection(id, body);
    auditUser(user, "connection.create", { type: "project", id }, `${body.engine}: ${body.name}`, req);
    return { connection: saved };
  });

  // 3. Update connection
  app.put("/api/projects/:id/connections/:connId", async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { user } = requireProjectAdmin(req, id);
    const body = (req.body ?? {}) as Partial<DatabaseConnectionConfig>;
    if (body.engine !== undefined && !VALID_ENGINES.has(body.engine)) throw new ApiError("CONNECTION_ENGINE_INVALID");

    const updated = updateConnection(connId, body);
    if (!updated) throw new ApiError("CONNECTION_NOT_FOUND");

    auditUser(user, "connection.update", { type: "project", id }, `${updated.engine}: ${updated.name}`, req);
    return { connection: updated };
  });

  // 4. Delete connection
  app.delete("/api/projects/:id/connections/:connId", async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { user } = requireProjectAdmin(req, id);

    const ok = deleteConnection(connId);
    if (!ok) throw new ApiError("CONNECTION_NOT_FOUND");

    auditUser(user, "connection.delete", { type: "project", id }, connId, req);
    return { deleted: true };
  });

  // 5. Test connection config
  app.post("/api/projects/:id/connections/test", async (req) => {
    const { id } = req.params as { id: string };
    requireProjectAdmin(req, id);
    const body = (req.body ?? {}) as DatabaseConnectionConfig;
    if (!VALID_ENGINES.has(body.engine)) throw new ApiError("CONNECTION_ENGINE_INVALID");

    const driver = await createDatabaseDriver(body);
    try {
      return await driver.testConnection();
    } finally {
      await driver.close().catch(() => {});
    }
  });

  // 6. Pull schema from live DB into canvas
  app.post("/api/projects/:id/connections/:connId/pull", async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { user, project } = requireProjectAdmin(req, id);

    const conn = getConnectionById(connId);
    if (!conn) throw new ApiError("CONNECTION_NOT_FOUND");

    const driver = await createDatabaseDriver(conn);
    try {
      const liveProject = await driver.introspectSchema();
      const room = getRoom(id);
      const current = readProjectFromDoc(room.doc, project.id, project.name);

      // Preserve existing canvas metadata / positions if tables already exist
      const existingTablesByName = new Map(current.tables.map((t) => [t.name.toLowerCase(), t]));
      const tables = liveProject.tables.map((table) => {
        const prev = existingTablesByName.get(table.name.toLowerCase());
        return {
          ...table,
          id: prev?.id ?? crypto.randomUUID(),
          position: prev?.position ?? table.position,
          size: prev?.size,
          style: prev?.style,
          detailLevel: prev?.detailLevel ?? "standard",
        };
      });

      const updatedProject = {
        ...current,
        tables,
        refs: liveProject.refs,
      };

      room.doc.transact(() => writeProjectToDoc(room.doc, updatedProject), user.displayName);
      auditUser(user, "connection.pull", { type: "project", id }, `${conn.engine} -> ${tables.length} tables`, req);

      return { pulled: true, tablesCount: tables.length };
    } finally {
      await driver.close().catch(() => {});
    }
  });

  // 7. Plan deployment: Diff canvas project vs live DB and inspect risks
  app.post("/api/projects/:id/connections/:connId/plan-deployment", async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { project } = requireProjectAdmin(req, id);

    const conn = getConnectionById(connId);
    if (!conn) throw new ApiError("CONNECTION_NOT_FOUND");

    const room = getRoom(id);
    const canvasProject = readProjectFromDoc(room.doc, project.id, project.name);

    const driver = await createDatabaseDriver(conn);
    try {
      const liveProject = await driver.introspectSchema();
      const diff = diffTargetAgainstLive(liveProject, canvasProject);
      const risks = await driver.inspectRisks(diff);
      const initialSql = generateMigrationSql(diff, conn.engine, {});

      return {
        diff,
        risks,
        sqlPreview: initialSql,
        engine: conn.engine,
      };
    } finally {
      await driver.close().catch(() => {});
    }
  });

  // 8. Apply deployment: Generate DDL with resolutions & execute transactionally
  app.post("/api/projects/:id/connections/:connId/apply-deployment", async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { user, project } = requireProjectAdmin(req, id);
    const body = (req.body ?? {}) as { resolutions?: MigrationResolutionMap };

    const conn = getConnectionById(connId);
    if (!conn) throw new ApiError("CONNECTION_NOT_FOUND");

    const room = getRoom(id);
    const canvasProject = readProjectFromDoc(room.doc, project.id, project.name);

    const driver = await createDatabaseDriver(conn);
    try {
      const liveProject = await driver.introspectSchema();
      const diff = diffTargetAgainstLive(liveProject, canvasProject);
      const sql = generateMigrationSql(diff, conn.engine, body.resolutions || {});

      const result = await driver.executeMigration(sql);
      if (!result.success) {
        throw new ApiError("MIGRATION_FAILED", {
          message: `migration failed: ${result.error}`,
          details: { error: result.error, sql },
        });
      }

      auditUser(user, "connection.deploy", { type: "project", id }, `${conn.engine}: executed ${result.executedStatements} statements`, req);

      return {
        success: true,
        executedStatements: result.executedStatements,
        sql,
      };
    } finally {
      await driver.close().catch(() => {});
    }
  });
}
