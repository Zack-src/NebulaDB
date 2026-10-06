import type { Project, Ref } from "@nebuladb/shared";

// Pure Project → Project, no `@dbml/core` import: safe client-side, like diff.ts.

/**
 * The current project with only some tables put back as they stood in an older revision ("restore
 * only this table"). Per table id: present in the revision -> its version replaces or re-adds it;
 * absent from the revision (created since) -> removed.
 *
 * A foreign key belongs to the table that **carries** it (`from`, as in `findLockViolations`): refs
 * carried by a restored table are the revision's, refs carried by others stay as they are unless
 * their target no longer exists. Everything else is untouched; a group loses removed table ids.
 */
export function restoreTables(current: Project, revision: Project, tableIds: readonly string[]): Project {
  const selected = new Set(tableIds);
  const fromRevision = new Map(revision.tables.filter((table) => selected.has(table.id)).map((t) => [t.id, t]));

  const tables = current.tables
    .filter((table) => !selected.has(table.id) || fromRevision.has(table.id))
    .map((table) => fromRevision.get(table.id) ?? table);
  const present = new Set(tables.map((table) => table.id));
  for (const table of fromRevision.values()) {
    if (!present.has(table.id)) tables.push(table);
  }

  const fieldsByTable = new Map(tables.map((table) => [table.id, new Set(table.fields.map((field) => field.id))]));
  const endpointsExist = (ref: Ref) =>
    Boolean(fieldsByTable.get(ref.from.tableId)?.has(ref.from.fieldId)) &&
    Boolean(fieldsByTable.get(ref.to.tableId)?.has(ref.to.fieldId));

  const refs = [
    ...current.refs.filter((ref) => !selected.has(ref.from.tableId)),
    ...revision.refs.filter((ref) => selected.has(ref.from.tableId)),
  ].filter(endpointsExist);

  return {
    ...current,
    tables,
    refs,
    tableGroups: current.tableGroups.map((group) =>
      group.tableIds.every((id) => fieldsByTable.has(id))
        ? group
        : { ...group, tableIds: group.tableIds.filter((id) => fieldsByTable.has(id)) },
    ),
  };
}
