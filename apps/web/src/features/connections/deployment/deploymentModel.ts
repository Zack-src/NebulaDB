import type { ConflictResolutionStrategy, SchemaRisk } from "@nebuladb/shared";
import type { TranslationKeyOf } from "@/types";

/** The words the plan used for each answer, so the history and a review request read the same. */
export const STRATEGY_LABEL: Record<ConflictResolutionStrategy, TranslationKeyOf> = {
  DROP_DATA_CONFIRMED: "connections.strategy.dropData",
  KEEP_IN_DB: "connections.strategy.keepInDb",
  FORCE_CAST: "connections.strategy.forceCast",
  CLEAR_COLUMN_DATA: "connections.strategy.clearData",
  BACKFILL_DEFAULT: "connections.strategy.backfillDefault",
  DELETE_OFFENDING_ROWS: "connections.strategy.deleteRows",
  CANCEL: "connections.strategy.cancel",
  PROCEED: "connections.strategy.proceed",
  USE_TRANSLATED_TYPE: "connections.strategy.useTranslatedType",
  KEEP_AS_WRITTEN: "connections.strategy.keepAsWritten",
};

/** The tabs of the deployment dialog — `done` only exists once a deployment went through. */
export type DeploymentStep = "diff" | "risks" | "sql" | "done" | "history";

/** Where a risk's answer goes in the resolutions — the server files it under the same key. */
export function riskKey(risk: SchemaRisk): string {
  if (risk.resolutionKey) return risk.resolutionKey;
  return risk.columnName
    ? `column:${risk.tableName.toLowerCase()}.${risk.columnName.toLowerCase()}`
    : `table:${risk.tableName.toLowerCase()}`;
}
