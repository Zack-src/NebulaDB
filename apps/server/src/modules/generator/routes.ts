import type { FastifyInstance } from "fastify";
import { parseCsv, seedColumnValues, toCsv, type Table } from "@nebuladb/shared";
import { readProjectReadOnly } from "../../realtime/readOnlyProject.js";
import { ApiError } from "../../shared/errors.js";
import { requireProjectAccess } from "../../shared/guards.js";
import { listSeedsWithContent } from "../seeds/repository.js";
import { getDataGeneratorProvider } from "./providers.js";
import { getGeneratorConfig, parseGeneratorConfig, saveGeneratorConfig } from "./repository.js";

const RUN_LIMIT = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };

/**
 * Parent keys for a table's foreign keys, from the project's own seeds — the
 * generator never reads a real database.
 */
function parentValuesFor(projectId: string, tables: readonly Table[]) {
  const byId = new Map(tables.map((table) => [table.id, table]));
  const values = new Map<string, Set<string>>();
  for (const seed of listSeedsWithContent(projectId)) {
    const table = byId.get(seed.tableId);
    if (!table) continue;
    for (const [key, set] of seedColumnValues(table, parseCsv(seed.content, seed.options.separator), seed.options)) {
      values.set(key, set);
    }
  }
  return values;
}

/**
 * Test data: generate rows for a table from its structure, and keep the
 * settings that produced them so a run can be repeated. The rows come back
 * as CSV with the field each column fills — ready to be saved as the table's
 * seed through the seed routes, which check them like any other file.
 */
export function registerGeneratorRoutes(app: FastifyInstance): void {
  app.get("/api/projects/:id/generators/:tableId", async (req) => {
    const { id, tableId } = req.params as { id: string; tableId: string };
    requireProjectAccess(req, id, "view");
    return { config: getGeneratorConfig(id, tableId) };
  });

  app.put("/api/projects/:id/generators/:tableId", async (req) => {
    const { id, tableId } = req.params as { id: string; tableId: string };
    const { user, project } = requireProjectAccess(req, id, "edit");
    if (!readProjectReadOnly(id, project.name).tables.some((t) => t.id === tableId))
      throw new ApiError("TABLE_NOT_FOUND");
    const config = parseGeneratorConfig(req.body);
    saveGeneratorConfig(id, tableId, config, user.displayName);
    return { config };
  });

  // Generating reads only the schema and the project's seeds: anyone who can open the project may.
  app.post("/api/projects/:id/generators/:tableId/run", RUN_LIMIT, async (req) => {
    const { id, tableId } = req.params as { id: string; tableId: string };
    const { project } = requireProjectAccess(req, id, "view");
    const schema = readProjectReadOnly(id, project.name);
    const table = schema.tables.find((t) => t.id === tableId);
    if (!table) throw new ApiError("TABLE_NOT_FOUND");
    const body = (req.body ?? {}) as { config?: unknown; provider?: unknown };
    const config = body.config === undefined ? getGeneratorConfig(id, tableId) : parseGeneratorConfig(body.config);
    if (!config) throw new ApiError("GENERATOR_INVALID", { message: "no configuration sent and none saved" });
    const provider = getDataGeneratorProvider(typeof body.provider === "string" ? body.provider : "builtin");
    const generated = await provider.generate({
      table,
      config,
      context: { refs: schema.refs, parentValues: parentValuesFor(id, schema.tables) },
    });
    return {
      provider: provider.id,
      columns: generated.columns.map((field) => ({ fieldId: field.id, name: field.name })),
      csv: toCsv(
        generated.columns.map((field) => field.name),
        generated.rows,
      ),
      rowCount: generated.rows.length,
      problems: generated.problems,
    };
  });
}
