import { readProjectFromDoc } from "@nebuladb/shared";
import { getRoom } from "../../realtime/roomRegistry.js";
import { compareConnections } from "../connections/compare.js";
import { projectPipeline, schemaHashOf } from "../pipeline/pipeline.js";
import { stageSkipFor } from "../pipeline/routes.js";
import type { FastifyInstance } from "fastify";
import type { DatabaseConnectionConfig, MigrationResolutionMap } from "@nebuladb/shared";
import { requireScope } from "../apiKeys/auth.js";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireProjectAccess, requireProjectAdmin } from "../../shared/guards.js";
import { createDatabaseDriver } from "../connections/drivers/index.js";
import { deployToConnection, rollbackConnectionDeployment } from "../connections/deploy.js";
import { pullConnectionSchema } from "../connections/pull.js";
import { listDeploymentHistory } from "../connections/deploymentHistory.js";
import { reconcileReviews } from "../reviews/service.js";
import { exportMigrations, isMigrationFormat } from "../connections/migrationExport.js";
import {
  getProjectConnection,
  listConnectionsByProject,
  saveConnection,
  unlinkProjectConnection,
  updateConnection,
} from "../connections/repository.js";
import { assertProjectMayEditConnection, assertTargetNotManaged, planDeployment } from "../connections/routes.js";
import { isValidEngine } from "../connections/engines.js";
import { API_RATE_LIMIT, DEPLOY_RATE_LIMIT } from "./rateLimits.js";

function requireValidEngine(engine: unknown): void {
  if (!isValidEngine(engine)) throw new ApiError("CONNECTION_ENGINE_INVALID");
}

/**
 * Database connections, and everything that touches one — CRUD, a
 * connectivity test, pulling a live schema onto the canvas, and the
 * deploy/rollback/history trio. No route but `GET` (list) is open to
 * `edit`, same reasoning and same split as the internal
 * `connections/routes.ts`: these open a connection to a host/file the
 * caller supplies, or execute generated SQL against it — a materially
 * larger blast radius than a plain schema edit. Using the project's
 * databases (deploy, rollback, history, pipeline, compare) takes `deploy`;
 * choosing them and pulling takes `administrator`.
 */
export function registerPublicConnectionRoutes(app: FastifyInstance): void {
  app.get("/api/v1/projects/:id/connections", API_RATE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    await requireProjectAccess(req, id, "view");
    requireScope(req, "projects:read", id);
    return { connections: await listConnectionsByProject(id) };
  });

  app.post("/api/v1/projects/:id/connections", API_RATE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    const { user } = await requireProjectAdmin(req, id);
    requireScope(req, "connections:manage", id);
    const body = (req.body ?? {}) as Omit<DatabaseConnectionConfig, "id">;
    if (!body.name?.trim()) throw new ApiError("NAME_REQUIRED");
    requireValidEngine(body.engine);
    await assertTargetNotManaged(user, body);

    const saved = await saveConnection(id, body);
    await auditUser(user, "connection.create", { type: "project", id }, `${body.engine}: ${body.name} (v1)`, req, {
      connectionId: saved.id,
    });
    return { connection: saved };
  });

  app.put("/api/v1/projects/:id/connections/:connId", API_RATE_LIMIT, async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { user } = await requireProjectAdmin(req, id);
    requireScope(req, "connections:manage", id);
    const body = (req.body ?? {}) as Partial<DatabaseConnectionConfig>;
    if (body.engine !== undefined) requireValidEngine(body.engine);

    await assertProjectMayEditConnection(user, id, connId);
    await assertTargetNotManaged(user, { ...(await getProjectConnection(id, connId))!, ...body });
    const updated = await updateConnection(connId, body, id);
    if (!updated) throw new ApiError("CONNECTION_NOT_FOUND");

    await auditUser(
      user,
      "connection.update",
      { type: "project", id },
      `${updated.engine}: ${updated.name} (v1)`,
      req,
      {
        connectionId: connId,
      },
    );
    await reconcileReviews(id, { user, req, v1: true });
    return { connection: updated };
  });

  app.delete("/api/v1/projects/:id/connections/:connId", API_RATE_LIMIT, async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { user } = await requireProjectAdmin(req, id);
    requireScope(req, "connections:manage", id);

    const ok = await unlinkProjectConnection(id, connId);
    if (!ok) throw new ApiError("CONNECTION_NOT_FOUND");

    await auditUser(user, "connection.delete", { type: "project", id }, `${connId} (v1)`, req, {
      connectionId: connId,
    });
    await reconcileReviews(id, { user, req, v1: true });
    return { deleted: true };
  });

  app.post("/api/v1/projects/:id/connections/test", API_RATE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    const { user } = await requireProjectAdmin(req, id);
    requireScope(req, "connections:manage", id);
    const body = (req.body ?? {}) as DatabaseConnectionConfig;
    requireValidEngine(body.engine);
    await assertTargetNotManaged(user, body);

    const driver = await createDatabaseDriver(body);
    try {
      return await driver.testConnection();
    } finally {
      await driver.close().catch(() => {});
    }
  });

  app.post("/api/v1/projects/:id/connections/:connId/pull", API_RATE_LIMIT, async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { user, project } = await requireProjectAdmin(req, id);
    requireScope(req, "connections:manage", id);

    const result = await pullConnectionSchema(id, project.name, connId, user.displayName, user.id);
    await auditUser(
      user,
      "connection.pull",
      { type: "project", id },
      `${connId} -> ${result.tablesCount} tables (v1)`,
      req,
      {
        connectionId: connId,
      },
    );

    return result;
  });

  app.post("/api/v1/projects/:id/connections/:connId/deploy", DEPLOY_RATE_LIMIT, async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { user, project } = await requireProjectAccess(req, id, "deploy");
    requireScope(req, "deployments:trigger", id);
    const body = (req.body ?? {}) as {
      resolutions?: MigrationResolutionMap;
      confirmName?: string;
      riskNote?: string;
      skipSeeds?: boolean;
      backupBefore?: boolean;
      skipStageOrder?: boolean;
      skipReason?: string;
    };

    const skipStageOrder = await stageSkipFor(req, id, connId, body);

    const result = await deployToConnection(id, project.name, connId, body.resolutions || {}, user.email, {
      confirmName: body.confirmName,
      riskNote: body.riskNote,
      skipSeeds: body.skipSeeds === true,
      backupBefore: typeof body.backupBefore === "boolean" ? body.backupBefore : undefined,
      skipStageOrder,
    });

    await auditUser(
      user,
      "connection.deploy",
      { type: "project", id },
      `${connId}: executed ${result.executedStatements} statements (v1)`,
      req,
      { connectionId: connId },
    );

    return result;
  });

  // What a deployment would do — the diff, its risks and the SQL — without doing it; what a CI job reads before `deploy`.
  app.post("/api/v1/projects/:id/connections/:connId/plan", DEPLOY_RATE_LIMIT, async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { project } = await requireProjectAccess(req, id, "deploy");
    requireScope(req, "projects:read", id);
    return await planDeployment(id, project, connId);
  });

  // Where the current schema has been deployed along the stages — what a CI job reads before promoting.
  app.get("/api/v1/projects/:id/pipeline", API_RATE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    const { project } = await requireProjectAccess(req, id, "deploy");
    requireScope(req, "projects:read", id);
    const schema = readProjectFromDoc((await getRoom(id)).doc, id, project.name);
    return { pipeline: await projectPipeline(id, schemaHashOf(schema)) };
  });

  // Two of the project's databases against each other. Reads both, changes nothing.
  app.post("/api/v1/projects/:id/connections/compare", DEPLOY_RATE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    const { project } = await requireProjectAccess(req, id, "deploy");
    requireScope(req, "projects:read", id);
    const { sourceId, targetId } = (req.body ?? {}) as { sourceId?: unknown; targetId?: unknown };
    return compareConnections(id, project.name, sourceId, targetId);
  });

  app.get("/api/v1/projects/:id/connections/:connId/history", API_RATE_LIMIT, async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    await requireProjectAccess(req, id, "deploy");
    requireScope(req, "projects:read", id);
    return { history: await listDeploymentHistory(id, connId) };
  });

  app.get("/api/v1/projects/:id/connections/:connId/history/export", API_RATE_LIMIT, async (req, reply) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { user, project } = await requireProjectAccess(req, id, "deploy");
    requireScope(req, "projects:read", id);
    const { format = "sql" } = req.query as { format?: string };
    if (!isMigrationFormat(format)) throw new ApiError("MIGRATION_FORMAT_INVALID");
    const conn = await getProjectConnection(id, connId);
    if (!conn) throw new ApiError("CONNECTION_NOT_FOUND");

    const { fileName, archive, files } = await exportMigrations(id, project.name, conn, format);
    await auditUser(
      user,
      "connection.migrations_export",
      { type: "project", id },
      `${connId}: ${format}, ${files} files (v1)`,
      req,
      { connectionId: connId },
    );
    return reply
      .header("content-type", "application/zip")
      .header("content-disposition", `attachment; filename="${fileName}"`)
      .send(archive);
  });

  app.post("/api/v1/projects/:id/connections/:connId/history/:historyId/rollback", DEPLOY_RATE_LIMIT, async (req) => {
    const { id, connId, historyId } = req.params as { id: string; connId: string; historyId: string };
    const { user } = await requireProjectAccess(req, id, "deploy");
    requireScope(req, "deployments:trigger", id);

    const { confirmName } = (req.body ?? {}) as { confirmName?: string };
    const result = await rollbackConnectionDeployment(id, connId, historyId, user.email, confirmName);

    await auditUser(
      user,
      "connection.rollback",
      { type: "project", id },
      `${connId}: rolled back ${historyId} (v1)`,
      req,
      {
        connectionId: connId,
      },
    );

    return result;
  });
}
