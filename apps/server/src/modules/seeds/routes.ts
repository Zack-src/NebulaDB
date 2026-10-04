import type { FastifyInstance } from "fastify";
import { readProjectReadOnly } from "../../realtime/readOnlyProject.js";
import { notifyProject } from "../../realtime/roomRegistry.js";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin, requireProjectAccess } from "../../shared/guards.js";
import { getProjectConnection } from "../connections/repository.js";
import { readTableAsSeed } from "./fromDatabase.js";
import { canOverrideLock, lockAuthorityOf } from "../tableLocks/access.js";
import { getTableLock } from "../tableLocks/repository.js";
import { deleteSeed, getSeed, listSeeds, parseSeedInput, upsertSeed } from "./repository.js";

/**
 * A `full` table lock freezes the table's data as well as its structure:
 * whoever the lock binds may not change or remove its seed. (A `structure`
 * lock leaves the seed alone — it is the rows, not the shape.)
 */
function assertSeedEditable(userId: string, projectId: string, tableId: string, tableName: string): void {
  const lock = getTableLock(projectId, tableId);
  if (lock?.level === "full" && !canOverrideLock(lockAuthorityOf(userId, projectId), lock)) {
    throw new ApiError("TABLE_LOCKED", {
      message: `locked table(s) cannot be changed: ${tableName}`,
      details: { tables: [tableName] },
    });
  }
}

const FROM_DATABASE_LIMIT = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

/**
 * Seeds: the rows a table starts with, inserted after the DDL of a
 * deployment (`deploySeeds.ts`). Reading needs `view`; setting or removing a
 * seed is an edit of the project, like changing its schema.
 */
export function registerSeedRoutes(app: FastifyInstance): void {
  app.get("/api/projects/:id/seeds", async (req) => {
    const { id } = req.params as { id: string };
    const { project } = requireProjectAccess(req, id, "view");
    // Listed under the names the tables have now.
    const names = new Map(readProjectReadOnly(id, project.name).tables.map((table) => [table.id, table.name]));
    return {
      seeds: listSeeds(id)
        .filter((seed) => names.has(seed.tableId))
        .map((seed) => ({ ...seed, tableName: names.get(seed.tableId)! })),
    };
  });

  app.get("/api/projects/:id/seeds/:tableId", async (req) => {
    const { id, tableId } = req.params as { id: string; tableId: string };
    requireProjectAccess(req, id, "view");
    const seed = getSeed(id, tableId);
    if (!seed) throw new ApiError("SEED_NOT_FOUND");
    return { seed };
  });

  app.put("/api/projects/:id/seeds/:tableId", { bodyLimit: 3 * 1024 * 1024 }, async (req) => {
    const { id, tableId } = req.params as { id: string; tableId: string };
    const { user, project } = requireProjectAccess(req, id, "edit");
    const table = readProjectReadOnly(id, project.name).tables.find((t) => t.id === tableId);
    if (!table) throw new ApiError("TABLE_NOT_FOUND");
    assertSeedEditable(user.id, id, tableId, table.name);
    const input = parseSeedInput(req.body);
    const seed = upsertSeed({
      projectId: id,
      tableId,
      tableName: table.name,
      ...input,
      updatedBy: user.id,
      updatedByName: user.displayName,
    });
    auditUser(user, "seed.set", { type: "project", id }, `${table.name}: ${input.rowCount} row(s)`, req);
    notifyProject(id, { type: "seeds-changed" });
    return { seed };
  });

  // The table's rows as they are in one of the project's databases, as a seed
  // to review. Instance administrators only, like the console and the
  // backups: this hands out every row of the table. Nothing is saved — the
  // dialog shows the rows checked, and saving is the ordinary PUT above.
  app.post("/api/projects/:id/seeds/:tableId/from-database", FROM_DATABASE_LIMIT, async (req) => {
    const { id, tableId } = req.params as { id: string; tableId: string };
    const user = requireAdmin(req);
    const { project } = requireProjectAccess(req, id, "edit");
    const { connectionId } = (req.body ?? {}) as { connectionId?: unknown };
    const connection = typeof connectionId === "string" ? getProjectConnection(id, connectionId) : null;
    if (!connection) throw new ApiError("CONNECTION_NOT_FOUND");
    const table = readProjectReadOnly(id, project.name).tables.find((t) => t.id === tableId);
    if (!table) throw new ApiError("TABLE_NOT_FOUND");
    const seed = await readTableAsSeed(connection, table);
    auditUser(
      user,
      "seed.read_database",
      { type: "project", id },
      `${table.name}: ${seed.rowCount} row(s) from ${connection.name}${seed.truncated ? " (truncated)" : ""}`,
      req,
      { connectionId: connection.id },
    );
    return { seed };
  });

  app.delete("/api/projects/:id/seeds/:tableId", async (req) => {
    const { id, tableId } = req.params as { id: string; tableId: string };
    const { user, project } = requireProjectAccess(req, id, "edit");
    const existing = getSeed(id, tableId);
    if (!existing) throw new ApiError("SEED_NOT_FOUND");
    const tableName =
      readProjectReadOnly(id, project.name).tables.find((t) => t.id === tableId)?.name ?? existing.tableName;
    assertSeedEditable(user.id, id, tableId, tableName);
    deleteSeed(id, tableId);
    auditUser(user, "seed.remove", { type: "project", id }, tableName, req);
    notifyProject(id, { type: "seeds-changed" });
    return { deleted: true };
  });
}
