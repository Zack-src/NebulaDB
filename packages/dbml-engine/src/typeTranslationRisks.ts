import type { DatabaseEngine, SchemaRisk } from "@athanordb/shared";
import { translateType } from "@athanordb/shared";
import type { MigrationDiff } from "./migrationDiff.js";

/**
 * Surfaces a `TYPE_TRANSLATION_SUGGESTED` risk for every new/changed column
 * whose written type isn't `targetEngine`'s native spelling (see
 * `translateType`). Only columns the diff already touches (new tables, and
 * added/modified fields on changed tables) are considered — a field the
 * diff leaves alone is already live on `targetEngine` in whatever form a
 * prior deployment gave it, so there's nothing new to confirm.
 *
 * Purely computed from the diff (no live DB access), unlike the row-count
 * risks each `DatabaseDriver.inspectRisks()` emits — callers merge both
 * lists for the deployment-preview wizard.
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
