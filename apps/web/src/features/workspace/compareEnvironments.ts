import type { SchemaComparisonEntry } from "@nebuladb/dbml-engine";

/** The two sides of a comparison: the chosen ones, else the current database against another. */
export function comparisonPair(
  connectionIds: string[],
  currentId: string | null,
  chosen: { source: string | null; target: string | null },
): { sourceId: string; targetId: string } {
  const targetId = chosen.target ?? currentId ?? connectionIds[0] ?? "";
  const sourceId = chosen.source ?? connectionIds.find((id) => id !== targetId) ?? "";
  return { sourceId, targetId };
}

export const canCompare = (sourceId: string, targetId: string): boolean =>
  sourceId !== "" && targetId !== "" && sourceId !== targetId;

/** How many tables are only in the source, only in the target, or in both with another structure. */
export function countByStatus(entries: SchemaComparisonEntry[]): Record<SchemaComparisonEntry["status"], number> {
  const counts = { "only-source": 0, "only-target": 0, different: 0 };
  for (const entry of entries) counts[entry.status] += 1;
  return counts;
}

/** What differs inside a shared table, flattened for display; `null` when the entry has no detail. */
export function detailRows(entry: SchemaComparisonEntry): {
  onlyInSource: string[];
  onlyInTarget: string[];
  changed: { name: string; before: string; after: string }[];
  flags: ("primaryKey" | "indexes" | "foreignKeys")[];
} | null {
  const detail = entry.detail;
  if (!detail) return null;
  const flags: ("primaryKey" | "indexes" | "foreignKeys")[] = [];
  if (detail.primaryKeyChanged) flags.push("primaryKey");
  if (detail.indexesChanged) flags.push("indexes");
  if (detail.foreignKeysChanged) flags.push("foreignKeys");
  return {
    onlyInSource: detail.columnsRemoved,
    onlyInTarget: detail.columnsAdded,
    changed: detail.columnsChanged,
    flags,
  };
}
