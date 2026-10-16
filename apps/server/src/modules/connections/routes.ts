import { stageSkipFor } from "../pipeline/routes.js";
import type { FastifyInstance } from "fastify";
import { readProjectFromDoc, type DatabaseConnectionConfig, type MigrationResolutionMap } from "@nebuladb/shared";
import { diffTargetAgainstLive, generateMigrationSql } from "@nebuladb/dbml-engine";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireProjectAccess, requireProjectAdmin, requireUser } from "../../shared/guards.js";
import { getRoom } from "../../realtime/roomRegistry.js";
import { createDatabaseDriver } from "./drivers/index.js";
import { deployToConnection, rollbackConnectionDeployment } from "./deploy.js";
import { compareConnections } from "./compare.js";
import { blockingLintFindings } from "../lint/check.js";
import { getLintSettings } from "../lint/repository.js";
import { projectPipeline, schemaHashOf } from "../pipeline/pipeline.js";
import { schemaForConnection } from "../environments/variables.js";
import { checkDrift, dismissOutOfSchema, listProjectDrift } from "./drift.js";
import { pullConnectionSchema } from "./pull.js";
import { analyzeDeploymentRisks } from "./riskAnalysis.js";
import { planSeeds, prepareSeeds } from "../seeds/deploySeeds.js";
import { createProjectFromDatabase } from "./createFromDatabase.js";
import { listDeploymentHistory } from "./deploymentHistory.js";
import { reconcileReviews } from "../reviews/service.js";
import { exportMigrations, isMigrationFormat } from "./migrationExport.js";
import {
  getConnectionOrigin,
  getProjectConnection,
  isAdminManagedTarget,
  isConnectionLinked,
  listConnectionsByProject,
  saveConnection,
  unlinkProjectConnection,
  updateConnection,
} from "./repository.js";
import { VALID_ENGINES } from "./engines.js";
import type { SessionUser } from "../auth/session.js";

/**
 * A server an instance administrator connected is reached through that
 * connection, which only they attach to a project. Without this, anyone could
 * create a project — they administer what they create — and deploy to that
 * server through a connection of their own, around the administrator's choice
 * of who may.
 */
export async function assertTargetNotManaged(
  user: SessionUser,
  config: Pick<DatabaseConnectionConfig, "engine" | "host" | "port" | "connectionString">,
): Promise<void> {
  if (!user.isAdmin && (await isAdminManagedTarget(config))) throw new ApiError("CONNECTION_TARGET_MANAGED");
}

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
export async function assertProjectMayEditConnection(
  user: SessionUser,
  projectId: string,
  connId: string,
): Promise<void> {
  if (!(await isConnectionLinked(projectId, connId))) throw new ApiError("CONNECTION_NOT_FOUND");
  if ((await getConnectionOrigin(connId)) === "admin" && !user.isAdmin)
    throw new ApiError("CONNECTION_MANAGED_BY_ADMIN");
}

/**
 * What deploying the project's current schema to a connection would do, without doing it: the diff
 * against the live database, its risks, the seeds, the SQL, and what would refuse the deployment
 * whatever the plan says. Shared by the app's route and `/api/v1`'s.
 */
export async function planDeployment(id: string, project: { id: string; name: string }, connId: string) {
  const conn = await getProjectConnection(id, connId);
  if (!conn) throw new ApiError("CONNECTION_NOT_FOUND");

  const room = await getRoom(id);
  const writtenProject = readProjectFromDoc(room.doc, project.id, project.name);
  const canvasProject = await schemaForConnection(writtenProject, conn);
  // What would refuse the deployment whatever the plan says — told with the
  // plan, not after "Apply". The deployment checks both again itself.
  const lintSettings = await getLintSettings(id);
  const stage = conn.environmentId
    ? (await projectPipeline(id, schemaHashOf(writtenProject))).stages.find((entry) => entry.id === conn.environmentId)
    : undefined;
  const blockingLint = blockingLintFindings(writtenProject, lintSettings);
  const blockers = {
    lintErrors: blockingLint.count,
    lintFindings: blockingLint.findings,
    waitsForStage: stage && !stage.ready ? stage.requires : null,
  };

  const driver = await createDatabaseDriver(conn);
  try {
    const liveProject = await driver.introspectSchema();
    const diff = diffTargetAgainstLive(liveProject, canvasProject);
    const risks = await analyzeDeploymentRisks(driver, diff, conn.engine);
    const preparedSeeds = await prepareSeeds(id, canvasProject);
    const created = new Set(diff.tables.filter((t) => t.status === "added").map((t) => t.name.toLowerCase()));
    const seeds = await planSeeds(driver, preparedSeeds, conn.engine, created);
    const initialSql = generateMigrationSql(diff, conn.engine, {});

    return {
      diff,
      risks,
      seeds,
      seedCycles: preparedSeeds.cycles,
      sqlPreview: initialSql,
      engine: conn.engine,
      blockers,
    };
  } finally {
    await driver.close().catch(() => {});
  }
}

/**
 * Nothing here but the list route is open to `edit`: these routes make the *server* open
 * connections to a caller-supplied host/file or execute generated SQL. `hostGuard.ts` and
 * `NEBULADB_SQLITE_DIR` narrow *where*; this narrows *who*.
 *
 * Two levels share them. `deploy` uses the databases the project already has — plan, deploy,
 * rollback, their history, compare, "check now". `administrator` decides which databases those
 * are (create, edit, detach, test a config), replaces the schema with a database's (pull) and
 * accepts a change made outside the schema (dismiss the drift mark).
 *
 * `from-database` only requires an authenticated user, like `POST /api/projects`: the caller
 * becomes the new project's administrator.
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
    await assertTargetNotManaged(user, connectionConfig);

    const result = await createProjectFromDatabase(
      user.id,
      user.displayName,
      projectName || connectionConfig.name,
      connectionConfig,
    );
    await auditUser(
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
    await requireProjectAccess(req, id, "view");
    return { connections: await listConnectionsByProject(id) };
  });

  // 2. Create connection
  app.post("/api/projects/:id/connections", CONNECTION_RATE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    const { user } = await requireProjectAdmin(req, id);
    const body = (req.body ?? {}) as Omit<DatabaseConnectionConfig, "id">;

    if (!body.name?.trim()) throw new ApiError("NAME_REQUIRED");
    if (!VALID_ENGINES.has(body.engine)) throw new ApiError("CONNECTION_ENGINE_INVALID");
    await assertTargetNotManaged(user, body);

    const saved = await saveConnection(id, body);
    await auditUser(user, "connection.create", { type: "project", id }, `${body.engine}: ${body.name}`, req, {
      connectionId: saved.id,
    });
    return { connection: saved };
  });

  // 3. Update connection
  app.put("/api/projects/:id/connections/:connId", CONNECTION_RATE_LIMIT, async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { user } = await requireProjectAdmin(req, id);
    const body = (req.body ?? {}) as Partial<DatabaseConnectionConfig>;
    if (body.engine !== undefined && !VALID_ENGINES.has(body.engine)) throw new ApiError("CONNECTION_ENGINE_INVALID");

    await assertProjectMayEditConnection(user, id, connId);
    await assertTargetNotManaged(user, { ...(await getProjectConnection(id, connId))!, ...body });
    const updated = await updateConnection(connId, body, id);
    if (!updated) throw new ApiError("CONNECTION_NOT_FOUND");

    await auditUser(user, "connection.update", { type: "project", id }, `${updated.engine}: ${updated.name}`, req, {
      connectionId: connId,
    });
    // Moved to another stage: a review asked for the old one no longer stands.
    await reconcileReviews(id, { user, req });
    return { connection: updated };
  });

  // 4. Delete connection
  app.delete("/api/projects/:id/connections/:connId", CONNECTION_RATE_LIMIT, async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { user } = await requireProjectAdmin(req, id);

    // Detaches; the connection itself only goes if this project created it
    // and nothing else uses it (see `unlinkProjectConnection`).
    const ok = await unlinkProjectConnection(id, connId);
    if (!ok) throw new ApiError("CONNECTION_NOT_FOUND");

    await auditUser(user, "connection.delete", { type: "project", id }, connId, req, { connectionId: connId });
    await reconcileReviews(id, { user, req });
    return { deleted: true };
  });

  // 5. Test connection config
  app.post("/api/projects/:id/connections/test", CONNECTION_RATE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    const { user } = await requireProjectAdmin(req, id);
    const body = (req.body ?? {}) as DatabaseConnectionConfig;
    if (!VALID_ENGINES.has(body.engine)) throw new ApiError("CONNECTION_ENGINE_INVALID");
    await assertTargetNotManaged(user, body);

    const driver = await createDatabaseDriver(body);
    try {
      return await driver.testConnection();
    } finally {
      await driver.close().catch(() => {});
    }
  });

  // 6. Pull schema from live DB into canvas
  // Not a deployment, though it reads the same database: it replaces the
  // schema everyone works on and makes the database's state the reference
  // drift is measured against. That stays with the project's administrators.
  app.post("/api/projects/:id/connections/:connId/pull", CONNECTION_RATE_LIMIT, async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { user, project } = await requireProjectAdmin(req, id);

    const result = await pullConnectionSchema(id, project.name, connId, user.displayName, user.id);
    await auditUser(
      user,
      "connection.pull",
      { type: "project", id },
      `${connId} -> ${result.tablesCount} tables`,
      req,
      {
        connectionId: connId,
      },
    );

    return result;
  });

  // 6b. Drift: has a linked database left the schema?
  // Reading the marks contacts no database, so anyone who can open the project
  // may: the banner is information, and an editor about to change a table the
  // database no longer matches should know. Looking at the database itself
  // is for those who may deploy to it; dismissing the mark stays with the
  // project's administrators.
  app.get("/api/projects/:id/drift", async (req) => {
    const { id } = req.params as { id: string };
    await requireProjectAccess(req, id, "view");
    return { connections: await listProjectDrift(id) };
  });

  // Two of the project's databases against each other. It opens both, so it
  // is for those who may deploy, like every route that reaches a database.
  app.post("/api/projects/:id/connections/compare", CONNECTION_RATE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    const { project } = await requireProjectAccess(req, id, "deploy");
    const { sourceId, targetId } = (req.body ?? {}) as { sourceId?: unknown; targetId?: unknown };
    return compareConnections(id, project.name, sourceId, targetId);
  });

  app.post("/api/projects/:id/connections/:connId/drift-check", CONNECTION_RATE_LIMIT, async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { project } = await requireProjectAccess(req, id, "deploy");
    return checkDrift(id, project.name, connId);
  });

  app.post("/api/projects/:id/connections/:connId/drift/dismiss", async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { user } = await requireProjectAdmin(req, id);
    if (!(await getProjectConnection(id, connId))) throw new ApiError("CONNECTION_NOT_FOUND");
    if (await dismissOutOfSchema(id, connId)) {
      await auditUser(user, "connection.drift.dismiss", { type: "project", id }, connId, req, { connectionId: connId });
    }
    return { dismissed: true };
  });

  // 7. Plan deployment: Diff canvas project vs live DB and inspect risks
  app.post("/api/projects/:id/connections/:connId/plan-deployment", CONNECTION_RATE_LIMIT, async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { project } = await requireProjectAccess(req, id, "deploy");
    return await planDeployment(id, project, connId);
  });

  // 8. Apply deployment: Generate DDL with resolutions & execute transactionally
  app.post("/api/projects/:id/connections/:connId/apply-deployment", CONNECTION_RATE_LIMIT, async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { user, project } = await requireProjectAccess(req, id, "deploy");
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
      `${connId}: executed ${result.executedStatements} statements`,
      req,
      { connectionId: connId },
    );

    return result;
  });

  // 9. Deployment history for a connection — what actually ran, and when.
  app.get("/api/projects/:id/connections/:connId/history", async (req) => {
    const { id, connId } = req.params as { id: string; connId: string };
    await requireProjectAccess(req, id, "deploy");
    return { history: await listDeploymentHistory(id, connId) };
  });

  /**
   * 9b. The history as versioned migration files (plain SQL, Flyway or
   * Liquibase), in one zip — see `migrationExport.ts` for what goes in.
   */
  app.get("/api/projects/:id/connections/:connId/history/export", CONNECTION_RATE_LIMIT, async (req, reply) => {
    const { id, connId } = req.params as { id: string; connId: string };
    const { user, project } = await requireProjectAccess(req, id, "deploy");
    const { format = "sql" } = req.query as { format?: string };
    if (!isMigrationFormat(format)) throw new ApiError("MIGRATION_FORMAT_INVALID");
    const conn = await getProjectConnection(id, connId);
    if (!conn) throw new ApiError("CONNECTION_NOT_FOUND");

    const { fileName, archive, files } = await exportMigrations(id, project.name, conn, format);
    await auditUser(
      user,
      "connection.migrations_export",
      { type: "project", id },
      `${connId}: ${format}, ${files} files`,
      req,
      {
        connectionId: connId,
      },
    );
    return reply
      .header("content-type", "application/zip")
      .header("content-disposition", `attachment; filename="${fileName}"`)
      .send(archive);
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
    const { user } = await requireProjectAccess(req, id, "deploy");

    const { confirmName } = (req.body ?? {}) as { confirmName?: string };
    const result = await rollbackConnectionDeployment(id, connId, historyId, user.email, confirmName);

    await auditUser(user, "connection.rollback", { type: "project", id }, `${connId}: rolled back ${historyId}`, req, {
      connectionId: connId,
    });

    return result;
  });
}
