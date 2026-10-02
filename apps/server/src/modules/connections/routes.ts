import type { FastifyInstance } from "fastify";
import { readProjectFromDoc, type DatabaseConnectionConfig, type MigrationResolutionMap } from "@athanordb/shared";
import { detectTypeTranslationRisks, diffTargetAgainstLive, generateMigrationSql } from "@athanordb/dbml-engine";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireProjectAccess, requireProjectAdmin, requireUser } from "../../shared/guards.js";
import { getRoom } from "../../realtime/roomRegistry.js";
import { createDatabaseDriver } from "./drivers/index.js";
import { deployToConnection, rollbackConnectionDeployment } from "./deploy.js";
import { pullConnectionSchema } from "./pull.js";
import { createProjectFromDatabase } from "./createFromDatabase.js";
import { listDeploymentHistory } from "./deploymentHistory.js";
import {
  getConnectionOrigin,
  getProjectConnection,
  isConnectionLinked,
  listConnectionsByProject,
  saveConnection,
  unlinkProjectConnection,
  updateConnection,
} from "./repository.js";
import { VALID_ENGINES } from "./engines.js";
import type { SessionUser } from "../auth/session.js";

/**
 * Per-caller ceiling on top of the per-target budget (`connectionBudget.ts`):
 * that one protects a database, this one stops a single session from cycling
 * through many different targets — every one of these routes makes the server
 * open an outbound connection.
 */
const CONNECTION_RATE_LIMIT = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };

/**
 * A connection reached through a project must be attached to it, and one an
 * instance admin created can only be *used* from a project, not edited:
 * its credentials may serve several projects.
 */
export function assertProjectMayEditConnection(user: SessionUser, projectId: string, connId: string): void {
  if (!isConnectionLinked(projectId, connId)) throw new ApiError("CONNECTION_NOT_FOUND");
  if (getConnectionOrigin(connId) === "admin" && !user.isAdmin) throw new ApiError("CONNECTION_MANAGED_BY_ADMIN");
}

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
 *
 * `from-database` is the one exception: there is no project yet to require
 * `administrator` on, so it only requires an authenticated user — the same
 * bar `POST /api/projects` already sets, since the caller becomes that new
 * project's administrator regardless of which route created it.
 */
export function registerConnectionRoutes(app: FastifyInstance): void {
  // 0. Create a brand-new project from a live database's introspected schema
  app.post("/api/projects/from-database", CONNECTION_RATE_LIMIT, async (req) => {
    const user = requireUser(req);
    const body = (req.body ?? {}) as { projectName?: string } & Omit<DatabaseConnectionConfig, "id" | "projectId">;

    if (!VALID_ENGINES.has(body.engine)) throw new ApiError("CONNECTION_ENGINE_INVALID");
    const { projectName, ...connectionConfig } = body;
    // `connectionConfig.name` is required by `saveConnection` (NOT NULL column) but, unlike the
    // per-project `POST .../connections` route, there's no reason to make a caller here supply two
    // names for what's overwhelmingly one thing — default it the same way the project name itself
    // falls back.
    connectionConfig.name =
      connectionConfig.name?.trim() || projectName?.trim() || connectionConfig.database || "Database";

    const result = await createProjectFromDatabase(
      user.id,
      user.displayName,
      projectName || connectionConfig.name,
      connectionConfig,
    );
    auditUser(
      user,
      "project.create",
      { type: "project", id: result.id },
      `from database: ${result.tablesCount} table(s)`,
      req,
    );

    return result;
  });

  // 1. List connections for a project
  app.get("/api/projects/:id/connections", async (req) => {
    const { id } = req.params as { id: string };
    requireProjectAccess(req, id, "view");
    return { connections: listConnectionsByProject(id) };
  });

  // 2. Create connection
  app.post("/api/projects/:id/connections", CONNECTION_RATE_LIMIT, async (req) => {
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
  app.put("/api/projects/:id/connections/:connId", CONNECTION_RATE_LIMIT, async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { user } = requireProjectAdmin(req, id);
    const body = (req.body ?? {}) as Partial<DatabaseConnectionConfig>;
    if (body.engine !== undefined && !VALID_ENGINES.has(body.engine)) throw new ApiError("CONNECTION_ENGINE_INVALID");

    assertProjectMayEditConnection(user, id, connId);
    const updated = updateConnection(connId, body, id);
    if (!updated) throw new ApiError("CONNECTION_NOT_FOUND");

    auditUser(user, "connection.update", { type: "project", id }, `${updated.engine}: ${updated.name}`, req);
    return { connection: updated };
  });

  // 4. Delete connection
  app.delete("/api/projects/:id/connections/:connId", CONNECTION_RATE_LIMIT, async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { user } = requireProjectAdmin(req, id);

    // Detaches; the connection itself only goes if this project created it
    // and nothing else uses it (see `unlinkProjectConnection`).
    const ok = unlinkProjectConnection(id, connId);
    if (!ok) throw new ApiError("CONNECTION_NOT_FOUND");

    auditUser(user, "connection.delete", { type: "project", id }, connId, req);
    return { deleted: true };
  });

  // 5. Test connection config
  app.post("/api/projects/:id/connections/test", CONNECTION_RATE_LIMIT, async (req) => {
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
  app.post("/api/projects/:id/connections/:connId/pull", CONNECTION_RATE_LIMIT, async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { user, project } = requireProjectAdmin(req, id);

    const result = await pullConnectionSchema(id, project.name, connId, user.displayName);
    auditUser(user, "connection.pull", { type: "project", id }, `${connId} -> ${result.tablesCount} tables`, req);

    return result;
  });

  // 7. Plan deployment: Diff canvas project vs live DB and inspect risks
  app.post("/api/projects/:id/connections/:connId/plan-deployment", CONNECTION_RATE_LIMIT, async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { project } = requireProjectAdmin(req, id);

    const conn = getProjectConnection(id, connId);
    if (!conn) throw new ApiError("CONNECTION_NOT_FOUND");

    const room = getRoom(id);
    const canvasProject = readProjectFromDoc(room.doc, project.id, project.name);

    const driver = await createDatabaseDriver(conn);
    try {
      const liveProject = await driver.introspectSchema();
      const diff = diffTargetAgainstLive(liveProject, canvasProject);
      const risks = [...(await driver.inspectRisks(diff)), ...detectTypeTranslationRisks(diff, conn.engine)];
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
  app.post("/api/projects/:id/connections/:connId/apply-deployment", CONNECTION_RATE_LIMIT, async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { user, project } = requireProjectAdmin(req, id);
    const body = (req.body ?? {}) as { resolutions?: MigrationResolutionMap };

    const result = await deployToConnection(id, project.name, connId, body.resolutions || {}, user.email);

    auditUser(
      user,
      "connection.deploy",
      { type: "project", id },
      `${connId}: executed ${result.executedStatements} statements`,
      req,
    );

    return result;
  });

  // 9. Deployment history for a connection — what actually ran, and when.
  app.get("/api/projects/:id/connections/:connId/history", async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    requireProjectAdmin(req, id);
    return { history: listDeploymentHistory(id, connId) };
  });

  /**
   * 10. Rollback a past deployment: re-runs the best-effort inverse SQL
   * generated (and stored) at the time that deployment was applied, against
   * whatever connection it originally targeted. Not offered a second time
   * once a rollback has actually succeeded — see
   * `deploymentHistory.ts`'s `rolledBack` for why that's derived, not a flag
   * that could drift.
   */
  app.post("/api/projects/:id/connections/:connId/history/:historyId/rollback", CONNECTION_RATE_LIMIT, async (req) => {
    const { id, connId, historyId } = req.params as { id: string; connId: string; historyId: string };
    const { user } = requireProjectAdmin(req, id);

    const result = await rollbackConnectionDeployment(id, connId, historyId, user.email);

    auditUser(user, "connection.rollback", { type: "project", id }, `${connId}: rolled back ${historyId}`, req);

    return result;
  });
}
