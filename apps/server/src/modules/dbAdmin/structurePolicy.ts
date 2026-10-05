import {
  STRUCTURE_POLICIES,
  type EffectiveStructurePolicy,
  type StructuralAction,
  type StructurePolicy,
  type StructurePolicyRefusal,
  type StructurePolicySetting,
} from "@athanordb/shared";
import { db } from "../../infrastructure/db.js";
import { ApiError } from "../../shared/errors.js";
import { connectionOwner, getAdminConnection } from "../connections/repository.js";

const SETTING_KEY = "structure_policy";

/**
 * What a fresh instance does: structure goes through the schema, typed SQL
 * included. An administrator relaxes it — for the instance, or for one
 * connection — rather than having to remember to tighten it.
 */
const DEFAULT_SETTING: StructurePolicySetting = { policy: "schema-only", applyToSql: true };

/** Accepts only a well-formed setting; anything else is the caller's `STRUCTURE_POLICY_INVALID`. */
export function parseStructurePolicySetting(value: unknown): StructurePolicySetting {
  const raw = (value ?? {}) as { policy?: unknown; applyToSql?: unknown };
  if (
    typeof value !== "object" ||
    value === null ||
    !STRUCTURE_POLICIES.includes(raw.policy as StructurePolicy) ||
    (raw.applyToSql !== undefined && typeof raw.applyToSql !== "boolean")
  ) {
    throw new ApiError("STRUCTURE_POLICY_INVALID");
  }
  return { policy: raw.policy as StructurePolicy, applyToSql: raw.applyToSql !== false };
}

export function getInstanceStructurePolicy(): StructurePolicySetting {
  const row = db.prepare("SELECT value FROM instance_settings WHERE key = ?").get(SETTING_KEY) as
    { value: string } | undefined;
  if (!row) return DEFAULT_SETTING;
  try {
    return parseStructurePolicySetting(JSON.parse(row.value));
  } catch {
    // A hand-edited or half-written row must not open the console up: fall back to the strict default.
    return DEFAULT_SETTING;
  }
}

export function setInstanceStructurePolicy(setting: StructurePolicySetting, userId: string): void {
  db.prepare(
    `INSERT INTO instance_settings (key, value, updated_by) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')`,
  ).run(SETTING_KEY, JSON.stringify(setting), userId);
}

/** The policy in force on a connection: its own when it has one, the instance's otherwise. */
export function effectiveStructurePolicy(connectionId: string): EffectiveStructurePolicy {
  if (connectionOwner(connectionId)) return { ...getInstanceStructurePolicy(), source: "instance", projects: [] };
  const connection = getAdminConnection(connectionId);
  if (!connection) throw new ApiError("CONNECTION_NOT_FOUND");
  const own = connection.structurePolicy;
  return {
    ...(own ?? getInstanceStructurePolicy()),
    source: own ? "connection" : "instance",
    projects: connection.projects,
  };
}

export type StructureVerdict = "not-structural" | "allowed" | "out-of-schema";

/**
 * Decides what happens to `actions` under `policy`.
 *
 * - No structural action, policy `free`, or a database no project models:
 *   nothing to say. The last one matters: "go through the schema" is not an
 *   answer when there is no schema, and a scratch database should not need a
 *   project to have a table dropped.
 * - `schema-only`: refused, with the projects to go to.
 * - `warn`: refused until `confirmed`, then let through as `out-of-schema` so
 *   the caller records it as such.
 */
export function judgeStructuralActions(
  policy: EffectiveStructurePolicy,
  actions: StructuralAction[],
  confirmed: boolean,
): StructureVerdict {
  if (actions.length === 0) return "not-structural";
  if (policy.policy === "free" || policy.projects.length === 0) return "allowed";
  const details: StructurePolicyRefusal = { policy: policy.policy, actions, projects: policy.projects };
  if (policy.policy === "schema-only") {
    throw new ApiError("STRUCTURE_VIA_SCHEMA", { details: { ...details } });
  }
  if (!confirmed) throw new ApiError("STRUCTURE_CONFIRMATION_REQUIRED", { details: { ...details } });
  return "out-of-schema";
}

/** `drop table orders, alter table users (phone)` — for the audit trail. */
export function describeStructuralActions(actions: StructuralAction[]): string {
  return actions.map((a) => `${a.verb} ${a.kind} ${a.object ?? "?"}${a.column ? ` (${a.column})` : ""}`).join(", ");
}
