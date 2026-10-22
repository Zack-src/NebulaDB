import { notifyFollowers } from "../notifications/repository.js";
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
import { parseCsv, seedOverflows } from "@nebuladb/shared";
import { deleteSeed, getSeed, listSeedsWithContent, parseSeedInput, upsertSeed } from "./repository.js";

/**
 * A `full` table lock freezes the table's data as well as its structure:
 * whoever the lock binds may not change or remove its seed. (A `structure`
 * lock leaves the seed alone — it is the rows, not the shape.)
 */
async function assertSeedEditable(
  userId: string,
  projectId: string,
  tableId: string,
  tableName: string,
): Promise<void> {
  const lock = await getTableLock(projectId, tableId);
  if (lock?.level === "full" && !canOverrideLock(await lockAuthorityOf(userId, projectId), lock)) {
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
    const { project } = await requireProjectAccess(req, id, "view");
    // Listed under the names the tables have now.
    const tables = new Map((await readProjectReadOnly(id, project.name)).tables.map((table) => [table.id, table]));
    return {
      seeds: (await listSeedsWithContent(id))
        .filter((seed) => tables.has(seed.tableId))
        .map(({ content, ...seed }) => {
          const table = tables.get(seed.tableId)!;
          // What the schema now allows against what the file holds: shrinking a varchar flags the seed here.
          const overflows = seedOverflows(table, parseCsv(content, seed.options.separator), seed.options);
          return { ...seed, tableName: table.name, ...(overflows.length > 0 ? { overflows } : {}) };
        }),
    };
  });

  app.get("/api/projects/:id/seeds/:tableId", async (req) => {
    const { id, tableId } = req.params as { id: string; tableId: string };
    await requireProjectAccess(req, id, "view");
    const seed = await getSeed(id, tableId);
    if (!seed) throw new ApiError("SEED_NOT_FOUND");
    return { seed };
  });

  app.put("/api/projects/:id/seeds/:tableId", { bodyLimit: 3 * 1024 * 1024 }, async (req) => {
    const { id, tableId } = req.params as { id: string; tableId: string };
    const { user, project } = await requireProjectAccess(req, id, "edit");
    const table = (await readProjectReadOnly(id, project.name)).tables.find((t) => t.id === tableId);
    if (!table) throw new ApiError("TABLE_NOT_FOUND");
    await assertSeedEditable(user.id, id, tableId, table.name);
    const input = parseSeedInput(req.body);
    const seed = await upsertSeed({
      projectId: id,
      tableId,
      tableName: table.name,
      ...input,
      updatedBy: user.id,
      updatedByName: user.displayName,
    });
    await auditUser(user, "seed.set", { type: "project", id }, `${table.name}: ${input.rowCount} row(s)`, req);
    await notifyFollowers(
      id,
      "seed",
      { removed: false, table: table.name, rows: input.rowCount, by: user.displayName },
      { actor: { id: user.id } },
    );
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
    const { project } = await requireProjectAccess(req, id, "edit");
    const { connectionId } = (req.body ?? {}) as { connectionId?: unknown };
    const connection = typeof connectionId === "string" ? await getProjectConnection(id, connectionId) : null;
    if (!connection) throw new ApiError("CONNECTION_NOT_FOUND");
    const table = (await readProjectReadOnly(id, project.name)).tables.find((t) => t.id === tableId);
    if (!table) throw new ApiError("TABLE_NOT_FOUND");
    const seed = await readTableAsSeed(connection, table);
    await auditUser(
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
    const { user, project } = await requireProjectAccess(req, id, "edit");
    const existing = await getSeed(id, tableId);
    if (!existing) throw new ApiError("SEED_NOT_FOUND");
    const tableName =
      (await readProjectReadOnly(id, project.name)).tables.find((t) => t.id === tableId)?.name ?? existing.tableName;
    await assertSeedEditable(user.id, id, tableId, tableName);
    await deleteSeed(id, tableId);
    await auditUser(user, "seed.remove", { type: "project", id }, tableName, req);
    await notifyFollowers(
      id,
      "seed",
      { removed: true, table: tableName, by: user.displayName },
      { actor: { id: user.id } },
    );
    notifyProject(id, { type: "seeds-changed" });
    return { deleted: true };
  });
}
