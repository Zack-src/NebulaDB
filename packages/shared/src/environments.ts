/**
 * Deployment stages ("environments"): the instance's chain DEV › … › Prod,
 * configured in Admin → Environnements. A database connection points at one
 * stage (or none); what a stage implies — its colour, and for the stage
 * flagged _production_ the stronger confirmation before a deployment — follows
 * the stage, not a guess on a label.
 */

/**
 * How guarded a stage is. Only `production` (a flag, see `EnvironmentStage`)
 * is enforced today; `protection` is recorded for the per-stage guards of the
 * pipeline (review, deployment windows — Phase 32) and shown next to the stage.
 */
export type EnvironmentProtection = "free" | "review" | "protected";

export const ENVIRONMENT_PROTECTIONS: readonly EnvironmentProtection[] = ["free", "review", "protected"];

/** The colours a stage can take — tokens the UI maps to its palette, never a raw CSS value. */
export type EnvironmentColor = "green" | "blue" | "violet" | "amber" | "orange" | "red" | "grey";

export const ENVIRONMENT_COLORS: readonly EnvironmentColor[] = [
  "green",
  "blue",
  "violet",
  "amber",
  "orange",
  "red",
  "grey",
];

export const ENVIRONMENT_NAME_MAX = 40;

export interface EnvironmentStage {
  id: string;
  name: string;
  color: EnvironmentColor;
  protection: EnvironmentProtection;
  /** At most one stage carries it: red everywhere, and a deployment to it asks for the connection's name. */
  production: boolean;
  /** 0-based place in the chain. */
  position: number;
  /** How many connections point at this stage. */
  connectionCount: number;
  /** What this stage calls the schema's `{{variables}}` — e.g. `{ schema: "sales", table_prefix: "pp_" }`. */
  variables: Record<string, string>;
}

/** What an administrator sends to create or change a stage. */
export interface EnvironmentStageInput {
  name?: string;
  color?: EnvironmentColor;
  protection?: EnvironmentProtection;
  production?: boolean;
  variables?: Record<string, string>;
}

/** One of a project's databases on the pipeline — `GET /api/projects/:id/pipeline`. */
export interface PipelineConnection {
  id: string;
  name: string;
  engine: "postgres" | "mysql" | "sqlite" | "mssql" | "oracle" | "bigquery";
  /** The last deployment or rollback this project ran against it; `null`: never. */
  lastDeployment: { at: string; by: string | null; success: boolean; rollback: boolean } | null;
  /** The last thing done here was a successful deployment of the schema as it is now. */
  level: boolean;
}

export interface PipelineStage {
  id: string;
  name: string;
  color: EnvironmentColor;
  production: boolean;
  protection: EnvironmentProtection;
  /** The project's databases on this stage; empty when it has none here. */
  connections: PipelineConnection[];
  /** The earlier stage that must be level before this one takes the schema; `null`: nothing to wait for. */
  requires: string | null;
  /** Whether a deployment to this stage would pass the order rule now. */
  ready: boolean;
}

export interface ProjectPipeline {
  /** Identity of the schema as written — what "level" is measured against. */
  schemaHash: string;
  stages: PipelineStage[];
  /** Databases of the project that are on no stage: outside the pipeline, deployed freely. */
  unstaged: PipelineConnection[];
}
