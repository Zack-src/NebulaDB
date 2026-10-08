import {
  compareSchemas,
  isCurrentTimeExpression,
  resolveVariables,
  schemaForDialect,
  type SchemaComparisonEntry,
} from "@nebuladb/dbml-engine";
import {
  neutralType,
  readProjectFromDoc,
  type DatabaseConnectionConfig,
  type DatabaseEngine,
  type Project,
} from "@nebuladb/shared";
import { getRoom } from "../../realtime/roomRegistry.js";
import { ApiError } from "../../shared/errors.js";
import { stageVariables } from "../environments/variables.js";
import { createDatabaseDriver } from "./drivers/index.js";
import { getProjectConnection } from "./repository.js";

interface ComparedSide {
  id: string;
  name: string;
  engine: DatabaseEngine;
  environment: string | null;
}

/** `POST /api/projects/:id/connections/compare`. */
export interface EnvironmentComparison {
  comparedAt: string;
  source: ComparedSide;
  target: ComparedSide;
  /** Tables that are not the same on both sides; empty when the two databases have one structure. */
  tables: SchemaComparisonEntry[];
}

async function readStructure(connection: DatabaseConnectionConfig): Promise<Project> {
  const driver = await createDatabaseDriver(connection);
  try {
    return await driver.introspectSchema();
  } finally {
    await driver.close().catch(() => {});
  }
}

/**
 * A structure as two different engines can both hold it: types without their
 * engine's spelling, "now" for whatever each calls the current time, and —
 * when one side is BigQuery — none of what BigQuery has no notion of. Without
 * it, SQL Server against BigQuery is 100 % "different": `int` is not `INT64`.
 */
function acrossEngines<T extends Pick<Project, "tables" | "refs">>(structure: T, withBigQuery: boolean): T {
  const held = withBigQuery ? schemaForDialect(structure as unknown as Project, "bigquery") : structure;
  return {
    ...structure,
    refs: held.refs,
    tables: held.tables.map((table) => ({
      ...table,
      fields: table.fields.map((field) => ({
        ...field,
        type: neutralType(field.type),
        default: field.default && isCurrentTimeExpression(field.default) ? "now" : field.default,
      })),
    })),
  };
}

/**
 * Not every engine's catalogue is read with sizes (SQL Server gives `varchar`,
 * BigQuery `STRING(255)`): a size only one side states cannot be compared, so
 * it is dropped from the other — `text` against `text(255)` is no difference,
 * `text(100)` against `text(255)` still is.
 */
function withoutOneSidedSizes<T extends Pick<Project, "tables" | "refs">>(a: T, b: T): void {
  const base = (type: string) => type.replace(/\(.*\)$/, "");
  const tables = new Map(b.tables.map((table) => [table.name.toLowerCase(), table]));
  for (const table of a.tables) {
    const other = new Map((tables.get(table.name.toLowerCase())?.fields ?? []).map((f) => [f.name.toLowerCase(), f]));
    for (const field of table.fields) {
      const twin = other.get(field.name.toLowerCase());
      if (!twin || field.type === twin.type || base(field.type) !== base(twin.type)) continue;
      if (field.type === base(field.type)) twin.type = field.type;
      else if (twin.type === base(twin.type)) field.type = twin.type;
    }
  }
}

const side = (connection: DatabaseConnectionConfig): ComparedSide => ({
  id: connection.id,
  name: connection.name,
  engine: connection.engine,
  environment: connection.environment ?? null,
});

/**
 * Two of the project's databases, read now and compared with each other —
 * "what does production lack that pre-production has". Structure only, by the
 * strict fingerprint; each table is also checked against the project's schema,
 * so an object that exists in a database and nowhere in the model is flagged.
 *
 * One database after the other, not both at once: two connections opened in
 * parallel from one request is twice the load for no gain a person would notice.
 */
export async function compareConnections(
  projectId: string,
  projectName: string,
  sourceId: unknown,
  targetId: unknown,
): Promise<EnvironmentComparison> {
  if (typeof sourceId !== "string" || typeof targetId !== "string" || sourceId === targetId) {
    throw new ApiError("COMPARISON_INVALID");
  }
  const source = getProjectConnection(projectId, sourceId);
  const target = getProjectConnection(projectId, targetId);
  if (!source || !target) throw new ApiError("CONNECTION_NOT_FOUND");

  let sourceStructure = await readStructure(source);
  let targetStructure = await readStructure(target);
  // "In the schema" under either stage's names: the two sides may spell `{{variables}}` differently.
  const written = readProjectFromDoc(getRoom(projectId).doc, projectId, projectName);
  const schema = {
    tables: [source, target].flatMap(
      (connection) => resolveVariables(written, stageVariables(connection.environmentId)).project.tables,
    ),
    refs: [],
  };
  let model: Pick<Project, "tables" | "refs"> = schema;
  if (source.engine !== target.engine) {
    const withBigQuery = source.engine === "bigquery" || target.engine === "bigquery";
    sourceStructure = acrossEngines(sourceStructure, withBigQuery);
    targetStructure = acrossEngines(targetStructure, withBigQuery);
    model = acrossEngines(schema, withBigQuery);
    withoutOneSidedSizes(sourceStructure, targetStructure);
  }
  return {
    comparedAt: new Date().toISOString(),
    source: side(source),
    target: side(target),
    tables: compareSchemas(sourceStructure, targetStructure, model),
  };
}
