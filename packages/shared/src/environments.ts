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
}

/** What an administrator sends to create or change a stage. */
export interface EnvironmentStageInput {
  name?: string;
  color?: EnvironmentColor;
  protection?: EnvironmentProtection;
  production?: boolean;
}
