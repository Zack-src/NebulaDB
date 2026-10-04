import { resolveVariables, type VariableValues } from "@athanordb/dbml-engine";
import type { Project } from "@athanordb/shared";
import { db } from "../../infrastructure/db.js";
import { ApiError } from "../../shared/errors.js";

/** The values a stage gives the schema's `{{variables}}`; none for a connection without a stage. */
export function stageVariables(environmentId: string | null | undefined): VariableValues {
  if (!environmentId) return {};
  const row = db.prepare("SELECT variables_json FROM environments WHERE id = ?").get(environmentId) as
    { variables_json: string } | undefined;
  return row ? (JSON.parse(row.variables_json) as VariableValues) : {};
}

/**
 * The schema as it is named on this connection's stage — what is compared
 * with the database and deployed to it. Refused, before anything touches the
 * database, when the schema uses a variable the stage does not define, or
 * when the stage's values leave a table without a name or give two tables
 * the same one: deploying a half-resolved name would create `{{prefix}}orders`.
 */
export function schemaForConnection(project: Project, connection: { environmentId?: string | null }): Project {
  const resolved = resolveVariables(project, stageVariables(connection.environmentId));
  if (resolved.missing.length + resolved.unnamed.length + resolved.collisions.length > 0) {
    throw new ApiError("VARIABLES_UNRESOLVED", {
      details: { missing: resolved.missing, unnamed: resolved.unnamed, collisions: resolved.collisions },
    });
  }
  return resolved.project;
}
