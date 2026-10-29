import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { notifyFollowers } from "../notifications/repository.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { parseCsv, SeedValidator, seedOverflows, type SeedOptions, type Table } from "@nebuladb/shared";
import { config } from "../../config.js";
import { readProjectReadOnly } from "../../realtime/readOnlyProject.js";
import { notifyProject } from "../../realtime/roomRegistry.js";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin, requireProjectAccess } from "../../shared/guards.js";
import type { SessionUser } from "../auth/session.js";
import { getProjectConnection } from "../connections/repository.js";
import { readTableAsSeed } from "./fromDatabase.js";
import { canOverrideLock, lockAuthorityOf } from "../tableLocks/access.js";
import { getTableLock } from "../tableLocks/repository.js";
import {
  deleteSeed,
  getSeed,
  listSeedsWithContent,
  parseSeedInput,
  parseSeedOptions,
  seedFileNameOf,
  upsertSeed,
  type StoredSeed,
} from "./repository.js";
import { ingestSeedStream, removeSeedFile, seedPreview, seedRowStream, type IngestResult } from "./seedFiles.js";

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
const FILE_UPLOAD_LIMIT = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };

/** What a client may see of a seed: never the name of the file on the server, never the file itself. */
function publicSeed({ fileName: _fileName, ...seed }: StoredSeed) {
  return seed;
}

/** The folder files may be imported from by path, resolved through links; throws when the feature is off. */
async function importRoot(): Promise<string> {
  if (!config.seedImportDir) throw new ApiError("SEED_IMPORT_UNAVAILABLE");
  return fsp.realpath(path.resolve(config.seedImportDir)).catch(() => {
    throw new ApiError("SEED_IMPORT_UNAVAILABLE");
  });
}

/** `requested` (relative to the import folder, or absolute) as a real path inside it. */
async function insideImportRoot(requested: string): Promise<string> {
  const root = await importRoot();
  const resolved = await fsp.realpath(path.resolve(root, requested)).catch(() => {
    throw new ApiError("SEED_IMPORT_UNAVAILABLE");
  });
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new ApiError("SEED_IMPORT_UNAVAILABLE");
  return resolved;
}

/** Seeds: the options a client sent in the `x-seed-options` header (URL-encoded JSON), or `null` to derive them from the file. */
function optionsFromHeader(req: FastifyRequest): SeedOptions | null {
  const raw = req.headers["x-seed-options"];
  if (typeof raw !== "string" || raw === "") return null;
  try {
    return parseSeedOptions(JSON.parse(decodeURIComponent(raw)));
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("SEED_INVALID");
  }
}

/**
 * Seeds: the rows a table starts with, inserted after the DDL of a
 * deployment (`deploySeeds.ts`). Reading needs `view`; setting or removing a
 * seed is an edit of the project, like changing its schema.
 *
 * A small seed (CSV up to 2 MB) lives in the database and travels as JSON;
 * a big one is a file on the server, sent as a raw stream (or read from the
 * import folder by an administrator) and checked while it arrives.
 */
export function registerSeedRoutes(app: FastifyInstance): void {
  /** Records a seed written by a stream, and tells whoever follows the project. */
  async function recordFileSeed(
    req: FastifyRequest,
    user: SessionUser,
    projectId: string,
    table: Table,
    ingested: IngestResult,
  ): Promise<StoredSeed> {
    const seed = await upsertSeed({
      projectId,
      tableId: table.id,
      tableName: table.name,
      content: "",
      options: ingested.options,
      rowCount: ingested.rowCount,
      file: { fileName: ingested.fileName, bytes: ingested.bytes, check: ingested.check },
      updatedBy: user.id,
      updatedByName: user.displayName,
    });
    await auditUser(
      user,
      "seed.set",
      { type: "project", id: projectId },
      `${table.name}: ${ingested.rowCount} row(s), file`,
      req,
    );
    await notifyFollowers(
      projectId,
      "seed",
      { removed: false, table: table.name, rows: ingested.rowCount, by: user.displayName },
      { actor: { id: user.id } },
    );
    notifyProject(projectId, { type: "seeds-changed" });
    return seed;
  }

  app.get("/api/projects/:id/seeds", async (req) => {
    const { id } = req.params as { id: string };
    const { project } = await requireProjectAccess(req, id, "view");
    // Listed under the names the tables have now.
    const tables = new Map((await readProjectReadOnly(id, project.name)).tables.map((table) => [table.id, table]));
    return {
      seeds: (await listSeedsWithContent(id))
        .filter((seed) => tables.has(seed.tableId))
        .map(({ content, fileName: _fileName, ...seed }) => {
          const table = tables.get(seed.tableId)!;
          // A file is not read again for a list: what its upload found is what the summary carries.
          if (seed.storage === "file") return { ...seed, tableName: table.name };
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
    return { seed: publicSeed(seed) };
  });

  // The first rows of a seed — the only look a file seed gives: its content is never sent whole.
  app.get("/api/projects/:id/seeds/:tableId/preview", async (req) => {
    const { id, tableId } = req.params as { id: string; tableId: string };
    await requireProjectAccess(req, id, "view");
    const seed = await getSeed(id, tableId);
    if (!seed) throw new ApiError("SEED_NOT_FOUND");
    const asked = Number((req.query as { rows?: string }).rows);
    const count = Number.isInteger(asked) && asked > 0 ? Math.min(asked, 200) : 50;
    return { rows: await seedPreview(seed, count + (seed.options.header ? 1 : 0)) };
  });

  app.put("/api/projects/:id/seeds/:tableId", { bodyLimit: 3 * 1024 * 1024 }, async (req) => {
    const { id, tableId } = req.params as { id: string; tableId: string };
    const { user, project } = await requireProjectAccess(req, id, "edit");
    const table = (await readProjectReadOnly(id, project.name)).tables.find((t) => t.id === tableId);
    if (!table) throw new ApiError("TABLE_NOT_FOUND");
    await assertSeedEditable(user.id, id, tableId, table.name);
    const input = parseSeedInput(req.body);
    const previousFile = await seedFileNameOf(id, tableId);
    const seed = await upsertSeed({
      projectId: id,
      tableId,
      tableName: table.name,
      ...input,
      updatedBy: user.id,
      updatedByName: user.displayName,
    });
    await removeSeedFile(previousFile);
    await auditUser(user, "seed.set", { type: "project", id }, `${table.name}: ${input.rowCount} row(s)`, req);
    await notifyFollowers(
      id,
      "seed",
      { removed: false, table: table.name, rows: input.rowCount, by: user.displayName },
      { actor: { id: user.id } },
    );
    notifyProject(id, { type: "seeds-changed" });
    return { seed: publicSeed(seed) };
  });

  // A big seed, sent as the raw bytes of the CSV (`text/csv`), the options in the `x-seed-options` header
  // (none: derived from the file). Parsed and checked as it arrives, never held in memory.
  void app.register(async (scope) => {
    scope.addContentTypeParser(["text/csv", "application/octet-stream"], (_req, payload, done) => done(null, payload));
    scope.put(
      "/api/projects/:id/seeds/:tableId/file",
      { bodyLimit: config.seedFileMaxBytes, ...FILE_UPLOAD_LIMIT },
      async (req) => {
        const { id, tableId } = req.params as { id: string; tableId: string };
        const { user, project } = await requireProjectAccess(req, id, "edit");
        const table = (await readProjectReadOnly(id, project.name)).tables.find((t) => t.id === tableId);
        if (!table) throw new ApiError("TABLE_NOT_FOUND");
        await assertSeedEditable(user.id, id, tableId, table.name);
        const options = optionsFromHeader(req);
        const ingested = await ingestSeedStream({
          projectId: id,
          table,
          source: req.body as AsyncIterable<Buffer>,
          options,
          maxBytes: config.seedFileMaxBytes,
        });
        const seed = await recordFileSeed(req, user, id, table, ingested);
        return { seed: publicSeed(seed), issues: ingested.issues, total: ingested.total };
      },
    );
  });

  // A file already on the server's machine, read from the import folder (`NEBULADB_SEED_IMPORT_DIR`). Instance
  // administrators only: it reads a file of the server. Options derived from the file unless given.
  app.post("/api/projects/:id/seeds/:tableId/from-path", FILE_UPLOAD_LIMIT, async (req) => {
    const { id, tableId } = req.params as { id: string; tableId: string };
    const user = requireAdmin(req);
    const { project } = await requireProjectAccess(req, id, "edit");
    const body = (req.body ?? {}) as { path?: unknown; options?: unknown };
    if (typeof body.path !== "string" || body.path === "") throw new ApiError("SEED_INVALID");
    const table = (await readProjectReadOnly(id, project.name)).tables.find((t) => t.id === tableId);
    if (!table) throw new ApiError("TABLE_NOT_FOUND");
    await assertSeedEditable(user.id, id, tableId, table.name);
    const file = await insideImportRoot(body.path);
    if (!(await fsp.stat(file)).isFile()) throw new ApiError("SEED_IMPORT_UNAVAILABLE");
    const ingested = await ingestSeedStream({
      projectId: id,
      table,
      source: fs.createReadStream(file, { highWaterMark: 1 << 20 }),
      options: body.options === undefined ? null : parseSeedOptions(body.options),
      maxBytes: config.seedFileMaxBytes,
    });
    const seed = await recordFileSeed(req, user, id, table, ingested);
    return { seed: publicSeed(seed), issues: ingested.issues, total: ingested.total };
  });

  // Every `<table>.csv` of a folder of the import folder becomes that table's seed: the files the migration
  // produced, named after the tables. A file with no table of that name is left out and reported.
  app.post("/api/projects/:id/seeds/import-folder", FILE_UPLOAD_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    const user = requireAdmin(req);
    const { project } = await requireProjectAccess(req, id, "edit");
    const body = (req.body ?? {}) as { path?: unknown };
    const folder = await insideImportRoot(typeof body.path === "string" ? body.path : ".");
    if (!(await fsp.stat(folder)).isDirectory()) throw new ApiError("SEED_IMPORT_UNAVAILABLE");
    const tables = (await readProjectReadOnly(id, project.name)).tables;
    const byName = new Map(tables.map((table) => [table.name.toLowerCase(), table]));
    const files = (await fsp.readdir(folder)).filter((name) => name.toLowerCase().endsWith(".csv")).sort();
    const results: {
      file: string;
      table: string | null;
      status: "imported" | "no-table" | "failed";
      rows?: number;
      errors?: number;
      warnings?: number;
      message?: string;
    }[] = [];
    for (const file of files) {
      const table = byName.get(file.slice(0, -4).toLowerCase());
      if (!table) {
        results.push({ file, table: null, status: "no-table" });
        continue;
      }
      try {
        await assertSeedEditable(user.id, id, table.id, table.name);
        const ingested = await ingestSeedStream({
          projectId: id,
          table,
          source: fs.createReadStream(path.join(folder, file), { highWaterMark: 1 << 20 }),
          options: null,
          maxBytes: config.seedFileMaxBytes,
        });
        await recordFileSeed(req, user, id, table, ingested);
        results.push({
          file,
          table: table.name,
          status: "imported",
          rows: ingested.rowCount,
          errors: ingested.check.errors,
          warnings: ingested.check.warnings,
        });
      } catch (err) {
        results.push({
          file,
          table: table.name,
          status: "failed",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { results };
  });

  // How a file seed is read: its separator, header, mapping and mode. The file stays as it is; it is checked
  // again under the new options, and the result replaces the one kept with it.
  app.put("/api/projects/:id/seeds/:tableId/options", async (req) => {
    const { id, tableId } = req.params as { id: string; tableId: string };
    const { user, project } = await requireProjectAccess(req, id, "edit");
    const table = (await readProjectReadOnly(id, project.name)).tables.find((t) => t.id === tableId);
    if (!table) throw new ApiError("TABLE_NOT_FOUND");
    await assertSeedEditable(user.id, id, tableId, table.name);
    const existing = await getSeed(id, tableId);
    if (!existing || existing.storage !== "file" || !existing.fileName) throw new ApiError("SEED_NOT_FOUND");
    const options = parseSeedOptions(req.body);
    const validator = new SeedValidator(table, options, {}, { maxKeys: config.seedMaxKeys });
    let width: number | null = null;
    for await (const cells of seedRowStream({ ...existing, options })) {
      width ??= cells.length;
      validator.add(cells);
    }
    if (width === null || options.mapping.length !== width) {
      throw new ApiError("SEED_INVALID", { message: "the mapping needs one entry per CSV column" });
    }
    const result = validator.finish();
    const seed = await upsertSeed({
      projectId: id,
      tableId,
      tableName: table.name,
      content: "",
      options,
      rowCount: result.rows,
      file: {
        fileName: existing.fileName,
        bytes: existing.bytes,
        check: {
          overflows: result.overflows,
          unchecked: result.unchecked,
          errors: result.total - result.warnings,
          warnings: result.warnings,
        },
      },
      updatedBy: user.id,
      updatedByName: user.displayName,
    });
    await auditUser(user, "seed.set", { type: "project", id }, `${table.name}: options of the file`, req);
    notifyProject(id, { type: "seeds-changed" });
    return { seed: publicSeed(seed), issues: result.issues, total: result.total };
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
    await removeSeedFile(existing.fileName);
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
