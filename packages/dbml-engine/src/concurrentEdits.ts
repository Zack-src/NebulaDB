import type { Field, Project, Ref, Table } from "@nebuladb/shared";
import { refSignature } from "./serialize.js";

/**
 * Protects edits made by *other* people while one client held a DBML buffer. The panel syncs by
 * posting its whole buffer, which overwrites the document, so anything created meanwhile by
 * someone else would be deleted.
 *
 * The client also sends the **baseline**, the exact text the buffer was derived from. Three-way,
 * name-keyed, case-insensitive:
 *
 *  - absent from the buffer **and** the baseline: created by someone else since: keep it.
 *  - absent from the buffer but in the baseline: the author deleted it: let it through.
 *
 * Concurrent *modifications* of the same entity aren't merged: the incoming buffer wins.
 */

const byName = <T extends { name: string }>(items: T[]): Map<string, T> =>
  new Map(items.map((item) => [item.name.toLowerCase(), item]));

function mergeFields(currentTable: Table, mergedTable: Table, baselineTable: Table | undefined): Table {
  const mergedNames = new Set(mergedTable.fields.map((field) => field.name.toLowerCase()));
  const baselineNames = new Set((baselineTable?.fields ?? []).map((field) => field.name.toLowerCase()));
  const restored: Field[] = currentTable.fields.filter(
    (field) => !mergedNames.has(field.name.toLowerCase()) && !baselineNames.has(field.name.toLowerCase()),
  );
  if (restored.length === 0) return mergedTable;
  return { ...mergedTable, fields: [...mergedTable.fields, ...restored] };
}

export function preserveConcurrentAdditions(current: Project, merged: Project, baseline: Project): Project {
  const mergedTables = byName(merged.tables);
  const baselineTables = byName(baseline.tables);

  // Columns other people added to tables this buffer still knows about.
  const tables: Table[] = merged.tables.map((table) => {
    const currentTable = byName(current.tables).get(table.name.toLowerCase());
    if (!currentTable) return table;
    return mergeFields(currentTable, table, baselineTables.get(table.name.toLowerCase()));
  });

  // Whole tables other people added.
  for (const table of current.tables) {
    const key = table.name.toLowerCase();
    if (mergedTables.has(key) || baselineTables.has(key)) continue;
    tables.push(table);
  }

  // Refs, keyed on their endpoints' names rather than ids (a ref id is never
  // DBML-native), resolved against the table list each project actually has.
  const mergedRefKeys = new Set(merged.refs.map((ref) => refSignature(merged.tables, ref)).filter(Boolean));
  const baselineRefKeys = new Set(baseline.refs.map((ref) => refSignature(baseline.tables, ref)).filter(Boolean));
  const refs: Ref[] = [...merged.refs];
  for (const ref of current.refs) {
    const key = refSignature(current.tables, ref);
    if (!key || mergedRefKeys.has(key) || baselineRefKeys.has(key)) continue;
    // Only restorable if both endpoints still exist in the result — a ref
    // whose table this buffer legitimately deleted goes with it.
    const hasEndpoints = tables.some((t) => t.id === ref.from.tableId) && tables.some((t) => t.id === ref.to.tableId);
    if (hasEndpoints) refs.push(ref);
  }

  const mergedEnums = byName(merged.enums);
  const baselineEnums = byName(baseline.enums);
  const enums = [...merged.enums];
  for (const enumDef of current.enums) {
    const key = enumDef.name.toLowerCase();
    if (mergedEnums.has(key) || baselineEnums.has(key)) continue;
    enums.push(enumDef);
  }

  const mergedGroups = byName(merged.tableGroups);
  const baselineGroups = byName(baseline.tableGroups);
  const tableGroups = [...merged.tableGroups];
  for (const group of current.tableGroups) {
    const key = group.name.toLowerCase();
    if (mergedGroups.has(key) || baselineGroups.has(key)) continue;
    tableGroups.push(group);
  }

  return { ...merged, tables, refs, enums, tableGroups };
}
