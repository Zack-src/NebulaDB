import { compareSchemas, resolveVariables, type SchemaComparisonEntry } from "@athanordb/dbml-engine";
import {
  readProjectFromDoc,
  type DatabaseConnectionConfig,
  type DatabaseEngine,
  type Project,
} from "@athanordb/shared";
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

  const sourceStructure = await readStructure(source);
  const targetStructure = await readStructure(target);
  // "In the schema" under either stage's names: the two sides may spell `{{variables}}` differently.
  const written = readProjectFromDoc(getRoom(projectId).doc, projectId, projectName);
  const schema = {
    tables: [source, target].flatMap(
      (connection) => resolveVariables(written, stageVariables(connection.environmentId)).project.tables,
    ),
    refs: [],
  };
  return {
    comparedAt: new Date().toISOString(),
    source: side(source),
    target: side(target),
    tables: compareSchemas(sourceStructure, targetStructure, schema),
  };
}
