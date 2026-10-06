import type { DatabaseConnectionConfig } from "@nebuladb/shared";
import type { FastifyInstance } from "fastify";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin } from "../../shared/guards.js";
import { createDatabaseDriver } from "../connections/drivers/index.js";
import { isValidEngine } from "../connections/engines.js";
import {
  checkConnectionProjects,
  createGlobalConnection,
  deleteConnection,
  getAdminConnection,
  listAllConnections,
  setConnectionProjects,
  updateGlobalConnection,
  type ConnectionProjectLink,
} from "../connections/repository.js";
import { quoteBacktick, quoteBracket, quoteDouble } from "./drivers/common.js";
import { checkConnectionHealth } from "./health.js";
import { READ_LIMIT, WRITE_LIMIT, assertWritable, loadConnection, withDriver } from "./routeKit.js";
import {
  getInstanceStructurePolicy,
  parseStructurePolicySetting,
  setInstanceStructurePolicy,
} from "./structurePolicy.js";

function parseConnectionBody(body: Record<string, unknown>, partial: boolean): Partial<DatabaseConnectionConfig> {
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) throw new ApiError("NAME_REQUIRED");
    if (body.name.length > 200) throw new ApiError("NAME_TOO_LONG");
  }
  if (!partial || body.engine !== undefined) {
    if (!isValidEngine(body.engine)) throw new ApiError("CONNECTION_ENGINE_INVALID");
  }
  // `null` clears the connection's own policy (back to the instance default).
  if (body.structurePolicy !== undefined && body.structurePolicy !== null) {
    body = { ...body, structurePolicy: parseStructurePolicySetting(body.structurePolicy) };
  }
  // Server-assigned or meaningless here; never taken from the client.
  const config = { ...body };
  for (const key of ["id", "projectId", "createdAt", "updatedAt"]) delete config[key];
  return config as Partial<DatabaseConnectionConfig>;
}

/** The projects to attach, each with its database — or the older `projectIds`, which leaves the databases as they are. */
function parseProjectLinks(body: { projectIds?: unknown; links?: unknown }): ConnectionProjectLink[] {
  if (Array.isArray(body.links)) {
    return body.links.map((raw) => {
      const link = (raw ?? {}) as { projectId?: unknown; database?: unknown };
      const databaseOk = link.database === undefined || link.database === null || typeof link.database === "string";
      if (typeof link.projectId !== "string" || !databaseOk) {
        throw new ApiError("DB_ADMIN_INPUT_INVALID", { message: "links must be { projectId, database? } objects" });
      }
      return { projectId: link.projectId, database: link.database as string | null | undefined };
    });
  }
  if (!Array.isArray(body.projectIds) || body.projectIds.some((p) => typeof p !== "string")) {
    throw new ApiError("DB_ADMIN_INPUT_INVALID", { message: "projectIds must be an array of project ids" });
  }
  return (body.projectIds as string[]).map((projectId) => ({ projectId }));
}

/**
 * Creates, on the connection's server, those of `names` that are not there
 * yet, and says which. Empty and nothing else: no owner, no options — what a
 * project needs to be deployed to, the rest being the administrator's to set
 * in the console. Engines with no `CREATE DATABASE` of that shape are refused.
 */
async function createMissingDatabases(connectionId: string, names: string[]): Promise<string[]> {
  const connection = loadConnection(connectionId);
  assertWritable(connection);
  const quote =
    connection.engine === "postgres"
      ? quoteDouble
      : connection.engine === "mysql"
        ? quoteBacktick
        : connection.engine === "mssql"
          ? quoteBracket
          : null;
  if (!quote) throw new ApiError("DB_ADMIN_UNSUPPORTED", { message: "creating a database is not supported here" });
  return withDriver(connection, "adminWrite", async (driver) => {
    const existing = new Set((await driver.listDatabases()).map((d) => d.name.toLowerCase()));
    const missing = names.filter((name) => !existing.has(name.toLowerCase()));
    for (const name of missing) {
      const sql = `CREATE DATABASE ${quote(name)}`;
      await driver.execute([{ sql, display: sql }]);
    }
    return missing;
  });
}

export function registerConnectionAdminRoutes(app: FastifyInstance): void {
  // ---- Connections ---------------------------------------------------------

  app.get("/api/admin/connections", READ_LIMIT, async (req) => {
    requireAdmin(req);
    return { connections: listAllConnections() };
  });

  app.post("/api/admin/connections", WRITE_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const config = parseConnectionBody((req.body ?? {}) as Record<string, unknown>, false) as DatabaseConnectionConfig;
    const connection = createGlobalConnection(config, user.id);
    auditUser(
      user,
      "dbconn.create",
      { type: "connection", id: connection.id },
      `${connection.engine}: ${connection.name}`,
      req,
    );
    return { connection };
  });

  app.put("/api/admin/connections/:id", WRITE_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const { id } = req.params as { id: string };
    const updates = parseConnectionBody((req.body ?? {}) as Record<string, unknown>, true);
    const before = getAdminConnection(id);
    const connection = updateGlobalConnection(id, updates);
    if (!connection) throw new ApiError("CONNECTION_NOT_FOUND");
    auditUser(user, "dbconn.update", { type: "connection", id }, `${connection.engine}: ${connection.name}`, req);
    // Its own line in the trail: loosening a policy is the kind of change someone asks about later.
    const describe = (setting: typeof connection.structurePolicy) =>
      setting ? `${setting.policy}${setting.applyToSql ? "" : " (not SQL)"}` : "instance default";
    if (before && before.authMode !== connection.authMode) {
      auditUser(
        user,
        "dbconn.auth_mode",
        { type: "connection", id },
        `${connection.name}: ${before.authMode} -> ${connection.authMode}`,
        req,
      );
    }
    if (describe(before?.structurePolicy ?? null) !== describe(connection.structurePolicy)) {
      auditUser(
        user,
        "dbconn.policy",
        { type: "connection", id },
        `${connection.name}: ${describe(before?.structurePolicy ?? null)} -> ${describe(connection.structurePolicy)}`,
        req,
      );
    }
    return { connection };
  });

  app.delete("/api/admin/connections/:id", WRITE_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const { id } = req.params as { id: string };
    const { force } = req.query as { force?: string };
    const connection = getAdminConnection(id);
    if (!connection) throw new ApiError("CONNECTION_NOT_FOUND");
    // Projects lose the ability to deploy to it; nothing else of theirs is touched.
    if (connection.projects.length > 0 && force !== "true") {
      throw new ApiError("CONNECTION_IN_USE", { details: { projects: connection.projects } });
    }
    deleteConnection(id);
    auditUser(user, "dbconn.delete", { type: "connection", id }, `${connection.engine}: ${connection.name}`, req);
    return { deleted: true };
  });

  app.put("/api/admin/connections/:id/projects", WRITE_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { projectIds?: unknown; links?: unknown; createDatabases?: unknown };
    const links = parseProjectLinks(body);
    const before = getAdminConnection(id);
    if (!before) throw new ApiError("CONNECTION_NOT_FOUND");

    // The databases the links newly name, made before the links are saved: a
    // project attached to a database that could not be created would only
    // find out at its first deployment.
    const known = new Set(before.projects.map((p) => `${p.id}\n${p.database ?? ""}`));
    const fresh = [
      ...new Set(
        links.flatMap((link) =>
          link.database && !known.has(`${link.projectId}\n${link.database}`) ? [link.database] : [],
        ),
      ),
    ];
    // Checked first, so that nothing is created on the server for links that will be refused.
    checkConnectionProjects(id, links);
    const created = body.createDatabases === true && fresh.length > 0 ? await createMissingDatabases(id, fresh) : [];
    setConnectionProjects(id, links);

    const connection = getAdminConnection(id)!;
    auditUser(
      user,
      "dbconn.link",
      { type: "connection", id },
      `${connection.projects.length} project(s)${created.length > 0 ? `; created ${created.join(", ")}` : ""}`,
      req,
    );
    return { connection, createdDatabases: created };
  });

  app.post("/api/admin/connections/test", WRITE_LIMIT, async (req) => {
    requireAdmin(req);
    const body = (req.body ?? {}) as Partial<DatabaseConnectionConfig> & { id?: string };
    if (!isValidEngine(body.engine)) throw new ApiError("CONNECTION_ENGINE_INVALID");
    // Editing an existing connection: the form never has the stored password,
    // so an empty one means "the one already saved".
    const stored = body.id ? loadConnection(body.id) : null;
    const config = { ...body, password: body.password || stored?.password } as DatabaseConnectionConfig;
    if (stored?.connectionString && body.connectionString?.includes("***"))
      config.connectionString = stored.connectionString;

    const driver = await createDatabaseDriver(config);
    try {
      return await driver.testConnection();
    } finally {
      await driver.close().catch(() => {});
    }
  });

  app.post("/api/admin/connections/:id/health", WRITE_LIMIT, async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const connection = await checkConnectionHealth(id);
    if (!connection) throw new ApiError("CONNECTION_NOT_FOUND");
    return { connection };
  });

  // ---- Structure policy ----------------------------------------------------

  app.get("/api/admin/settings/structure-policy", READ_LIMIT, async (req) => {
    requireAdmin(req);
    return { setting: getInstanceStructurePolicy() };
  });

  app.put("/api/admin/settings/structure-policy", WRITE_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const setting = parseStructurePolicySetting(req.body);
    const previous = getInstanceStructurePolicy();
    setInstanceStructurePolicy(setting, user.id);
    auditUser(
      user,
      "instance.structure_policy",
      null,
      `${previous.policy}${previous.applyToSql ? "" : " (not SQL)"} -> ${setting.policy}${setting.applyToSql ? "" : " (not SQL)"}`,
      req,
    );
    return { setting };
  });
}
