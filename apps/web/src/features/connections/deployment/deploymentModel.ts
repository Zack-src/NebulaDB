import type { SchemaRisk } from "@nebuladb/shared";

/** The tabs of the deployment dialog — `done` only exists once a deployment went through. */
export type DeploymentStep = "diff" | "risks" | "sql" | "done" | "history";

/** Where a risk's answer goes in the resolutions — the server files it under the same key. */
export function riskKey(risk: SchemaRisk): string {
  if (risk.resolutionKey) return risk.resolutionKey;
  return risk.columnName
    ? `column:${risk.tableName.toLowerCase()}.${risk.columnName.toLowerCase()}`
    : `table:${risk.tableName.toLowerCase()}`;
}
