import { fingerprintSchema } from "@nebuladb/dbml-engine";
import type { DatabaseEngine, EnvironmentStage, PipelineConnection, Project, ProjectPipeline } from "@nebuladb/shared";
import { db } from "../../infrastructure/db.js";
import { ApiError } from "../../shared/errors.js";
import { listEnvironments } from "../environments/repository.js";

/**
 * The schema's identity for the pipeline: the structure as written in the
 * project (placeholders and all), so the same schema has the same hash on
 * every stage whatever each stage calls its tables.
 */
export function schemaHashOf(project: Pick<Project, "tables" | "refs">): string {
  return fingerprintSchema(project).hash;
}

interface LinkRow {
  id: string;
  name: string;
  engine: string;
  environment_id: string | null;
}

interface LastRow {
  created_at: string;
  executed_by_email: string | null;
  success: number;
  rollback_of: string | null;
  schema_hash: string | null;
  rolled_back: number;
}

/** What last happened to a database from this project, and whether it left it at `schemaHash`. */
function connectionState(projectId: string, link: LinkRow, schemaHash: string): PipelineConnection {
  const last = db
    .prepare(
      `SELECT h.created_at, h.executed_by_email, h.success, h.rollback_of, h.schema_hash,
              EXISTS (SELECT 1 FROM deployment_history r WHERE r.rollback_of = h.id AND r.success = 1) AS rolled_back
         FROM deployment_history h
        WHERE h.project_id = ? AND h.connection_id = ?
        ORDER BY h.rowid DESC LIMIT 1`,
    )
    .get(projectId, link.id) as LastRow | undefined;
  return {
    id: link.id,
    name: link.name,
    engine: link.engine as DatabaseEngine,
    lastDeployment: last
      ? {
          at: last.created_at,
          by: last.executed_by_email,
          success: last.success === 1,
          rollback: last.rollback_of !== null,
        }
      : null,
    // Level: the last thing done here was a successful deployment of exactly this schema.
    level: Boolean(
      last && last.success === 1 && last.rollback_of === null && !last.rolled_back && last.schema_hash === schemaHash,
    ),
  };
}

const guarded = (stage: Pick<EnvironmentStage, "protection">) => stage.protection !== "free";

/**
 * The project's databases laid along the instance's chain of stages: where the
 * current schema has been deployed, and which stage a guarded stage waits for.
 *
 * The rule (`requires`): a stage whose protection is not `free` takes a schema
 * only once the nearest earlier stage *on which this project has a database*
 * is level with it. A project with a single database, or none before the
 * guarded stage, has nothing to wait for.
 */
export function projectPipeline(projectId: string, schemaHash: string): ProjectPipeline {
  const links = db
    .prepare(
      `SELECT c.id, c.name, c.engine, c.environment_id
         FROM db_connections c JOIN project_connection_links l ON l.connection_id = c.id
        WHERE l.project_id = ? ORDER BY c.name`,
    )
    .all(projectId) as LinkRow[];
  const states = links.map((link) => ({ link, state: connectionState(projectId, link, schemaHash) }));

  let previous: { name: string; level: boolean } | null = null;
  const stages = listEnvironments().map((stage) => {
    const connections = states.filter(({ link }) => link.environment_id === stage.id).map(({ state }) => state);
    const requires = guarded(stage) && connections.length > 0 && previous ? previous.name : null;
    const entry = {
      id: stage.id,
      name: stage.name,
      color: stage.color,
      production: stage.production,
      protection: stage.protection,
      connections,
      requires,
      ready: requires === null || previous!.level,
    };
    if (connections.length > 0) previous = { name: stage.name, level: connections.some((c) => c.level) };
    return entry;
  });
  return {
    schemaHash,
    stages,
    unstaged: states.filter(({ link }) => link.environment_id === null).map(({ state }) => state),
  };
}

/**
 * Refuses a deployment that would skip a stage. `skip` is the explicit way
 * past — the route only passes it for an instance administrator who gave a
 * reason, and audits it.
 */
export function assertStageOrder(
  projectId: string,
  connection: { id: string; environmentId?: string | null },
  schemaHash: string,
  skip: boolean,
): void {
  if (skip || !connection.environmentId) return;
  const stage = projectPipeline(projectId, schemaHash).stages.find((entry) => entry.id === connection.environmentId);
  if (!stage || stage.ready) return;
  throw new ApiError("PIPELINE_STAGE_SKIPPED", { details: { stage: stage.name, requires: stage.requires } });
}
