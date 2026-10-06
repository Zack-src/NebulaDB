import type { DatabaseEngine, SchemaRisk } from "@nebuladb/shared";
import { translateType } from "@nebuladb/shared";
import type { MigrationDiff } from "./migrationDiff.js";

/**
 * Surfaces a `TYPE_TRANSLATION_SUGGESTED` risk for every new or changed column whose written type
 * isn't `targetEngine`'s native spelling (`translateType`). Only columns the diff touches count.
 * Computed from the diff alone (no live DB), unlike the row-count risks of
 * `DatabaseDriver.inspectRisks()`; callers merge both for the deployment preview.
 */
export function detectTypeTranslationRisks(diff: MigrationDiff, targetEngine: DatabaseEngine): SchemaRisk[] {
  const risks: SchemaRisk[] = [];

  for (const table of diff.tables) {
    if (table.status === "dropped") continue;

    for (const fieldChange of table.fields) {
      if (fieldChange.status === "dropped" || !fieldChange.after) continue;

      const field = fieldChange.after;
      const translation = translateType(field.type, targetEngine);
      if (!translation.changed) continue;

      risks.push({
        id: `risk-type-translation-${table.name}-${field.name}`,
        type: "TYPE_TRANSLATION_SUGGESTED",
        severity: "info",
        tableName: table.name,
        columnName: field.name,
        affectedRowCount: 0,
        suggestedValue: translation.type,
        availableStrategies: [
          {
            key: "USE_TRANSLATED_TYPE",
            labelKey: "connections.strategy.useTranslatedType",
            descriptionKey: "connections.strategy.useTranslatedTypeDesc",
          },
          {
            key: "KEEP_AS_WRITTEN",
            labelKey: "connections.strategy.keepAsWritten",
            descriptionKey: "connections.strategy.keepAsWrittenDesc",
          },
        ],
        defaultStrategy: "USE_TRANSLATED_TYPE",
        selectedStrategy: "USE_TRANSLATED_TYPE",
      });
    }
  }

  return risks;
}
