import type { FastifyInstance } from "fastify";
import type { DatabaseConnectionConfig, MigrationResolutionMap } from "@athanordb/shared";
import { requireScope } from "../apiKeys/auth.js";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireProjectAccess, requireProjectAdmin } from "../../shared/guards.js";
import { createDatabaseDriver } from "../connections/drivers/index.js";
import { deployToConnection, rollbackConnectionDeployment } from "../connections/deploy.js";
import { pullConnectionSchema } from "../connections/pull.js";
import { listDeploymentHistory } from "../connections/deploymentHistory.js";
import {
  listConnectionsByProject,
  saveConnection,
  unlinkProjectConnection,
  updateConnection,
} from "../connections/repository.js";
import { assertProjectMayEditConnection } from "../connections/routes.js";
import { isValidEngine } from "../connections/engines.js";
import { API_RATE_LIMIT, DEPLOY_RATE_LIMIT } from "./rateLimits.js";

function requireValidEngine(engine: unknown): void {
  if (!isValidEngine(engine)) throw new ApiError("CONNECTION_ENGINE_INVALID");
}

/**
 * Database connections, and everything that touches one — CRUD, a
 * connectivity test, pulling a live schema onto the canvas, and the
 * deploy/rollback/history trio. Every route but `GET` (list) requires
 * project `administrator`, same reasoning as the internal
 * `connections/routes.ts`: these open a connection to a host/file the
 * caller supplies, or execute generated SQL against it — a materially
 * larger blast radius than a plain schema edit.
 */
export function registerPublicConnectionRoutes(app: FastifyInstance): void {
  app.get("/api/v1/projects/:id/connections", API_RATE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    requireProjectAccess(req, id, "view");
    requireScope(req, "projects:read", id);
    return { connections: listConnectionsByProject(id) };
  });

  app.post("/api/v1/projects/:id/connections", API_RATE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requireProjectAdmin(req, id);
    requireScope(req, "connections:manage", id);
    const body = (req.body ?? {}) as Omit<DatabaseConnectionConfig, "id">;
    if (!body.name?.trim()) throw new ApiError("NAME_REQUIRED");
    requireValidEngine(body.engine);

    const saved = saveConnection(id, body);
    auditUser(user, "connection.create", { type: "project", id }, `${body.engine}: ${body.name} (v1)`, req, {
      connectionId: saved.id,
    });
    return { connection: saved };
  });

  app.put("/api/v1/projects/:id/connections/:connId", API_RATE_LIMIT, async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { user } = requireProjectAdmin(req, id);
    requireScope(req, "connections:manage", id);
    const body = (req.body ?? {}) as Partial<DatabaseConnectionConfig>;
    if (body.engine !== undefined) requireValidEngine(body.engine);

    assertProjectMayEditConnection(user, id, connId);
    const updated = updateConnection(connId, body, id);
    if (!updated) throw new ApiError("CONNECTION_NOT_FOUND");

    auditUser(user, "connection.update", { type: "project", id }, `${updated.engine}: ${updated.name} (v1)`, req, {
      connectionId: connId,
    });
    return { connection: updated };
  });

  app.delete("/api/v1/projects/:id/connections/:connId", API_RATE_LIMIT, async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { user } = requireProjectAdmin(req, id);
    requireScope(req, "connections:manage", id);

    const ok = unlinkProjectConnection(id, connId);
    if (!ok) throw new ApiError("CONNECTION_NOT_FOUND");

    auditUser(user, "connection.delete", { type: "project", id }, `${connId} (v1)`, req, { connectionId: connId });
    return { deleted: true };
  });

  app.post("/api/v1/projects/:id/connections/test", API_RATE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    requireProjectAdmin(req, id);
    requireScope(req, "connections:manage", id);
    const body = (req.body ?? {}) as DatabaseConnectionConfig;
    requireValidEngine(body.engine);

    const driver = await createDatabaseDriver(body);
    try {
      return await driver.testConnection();
    } finally {
      await driver.close().catch(() => {});
    }
  });

  app.post("/api/v1/projects/:id/connections/:connId/pull", API_RATE_LIMIT, async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { user, project } = requireProjectAdmin(req, id);
    requireScope(req, "connections:manage", id);

    const result = await pullConnectionSchema(id, project.name, connId, user.displayName, user.id);
    auditUser(user, "connection.pull", { type: "project", id }, `${connId} -> ${result.tablesCount} tables (v1)`, req, {
      connectionId: connId,
    });

    return result;
  });

  app.post("/api/v1/projects/:id/connections/:connId/deploy", DEPLOY_RATE_LIMIT, async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { user, project } = requireProjectAdmin(req, id);
    requireScope(req, "deployments:trigger", id);
    const body = (req.body ?? {}) as {
      resolutions?: MigrationResolutionMap;
      confirmName?: string;
      riskNote?: string;
      skipSeeds?: boolean;
    };

    const result = await deployToConnection(id, project.name, connId, body.resolutions || {}, user.email, {
      confirmName: body.confirmName,
      riskNote: body.riskNote,
      skipSeeds: body.skipSeeds === true,
    });

    auditUser(
      user,
      "connection.deploy",
      { type: "project", id },
      `${connId}: executed ${result.executedStatements} statements (v1)`,
      req,
      { connectionId: connId },
    );

    return result;
  });

  app.get("/api/v1/projects/:id/connections/:connId/history", API_RATE_LIMIT, async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    requireProjectAdmin(req, id);
    requireScope(req, "projects:read", id);
    return { history: listDeploymentHistory(id, connId) };
  });

  app.post("/api/v1/projects/:id/connections/:connId/history/:historyId/rollback", DEPLOY_RATE_LIMIT, async (req) => {
    const { id, connId, historyId } = req.params as { id: string; connId: string; historyId: string };
    const { user } = requireProjectAdmin(req, id);
    requireScope(req, "deployments:trigger", id);

    const { confirmName } = (req.body ?? {}) as { confirmName?: string };
    const result = await rollbackConnectionDeployment(id, connId, historyId, user.email, confirmName);

    auditUser(user, "connection.rollback", { type: "project", id }, `${connId}: rolled back ${historyId} (v1)`, req, {
      connectionId: connId,
    });

    return result;
  });
}
