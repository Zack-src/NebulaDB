import type { Field, Project, Ref, Table } from "./schema.js";

/**
 * Which way a `Ref` points. The rule every SQL path follows: **`from` is the column that carries
 * the foreign key, `to` the column it references**; a `one-to-many` reads "many `from` rows point
 * at one `to` row" and becomes `ALTER TABLE <from> ADD FOREIGN KEY`.
 *
 * Older refs can be stored backwards (inline DBML `[ref: > ...]` was once parsed backwards), so
 * this module also decides when a stored ref is *certainly* inverted and can be flipped.
 */

function isKey(field: Field | undefined, table: Table | undefined): boolean {
  if (!field) return false;
  if (field.pk || field.unique) return true;
  // A single-column `pk`/`unique` index is just as much a key as the field flag.
  return Boolean(
    table?.indexes.some(
      (index) => (index.pk || index.unique) && index.fieldIds.length === 1 && index.fieldIds[0] === field.id,
    ),
  );
}

function endpointField(tablesById: Map<string, Table>, tableId: string, fieldId: string) {
  const table = tablesById.get(tableId);
  return { table, field: table?.fields.find((f) => f.id === fieldId) };
}

/**
 * True when `ref` is stored backwards beyond doubt:
 * - `one-to-many`: a referenced column must be a key and the owning side of a to-many can't be, so
 *   `from` a key and `to` not means swapped.
 * - `one-to-one`: only the classic shape is caught (`from` a primary key, `to` a unique non-PK
 *   column). An owning PK with a merely `unique` target would be misread; rare enough to accept.
 * - `many-to-many` has no owning side: never flipped.
 */
export function isRefInverted(ref: Ref, tablesById: Map<string, Table>): boolean {
  if (ref.cardinality === "many-to-many") return false;
  const from = endpointField(tablesById, ref.from.tableId, ref.from.fieldId);
  const to = endpointField(tablesById, ref.to.tableId, ref.to.fieldId);
  if (!from.field || !to.field) return false;
  if (ref.cardinality === "one-to-many") return isKey(from.field, from.table) && !isKey(to.field, to.table);
  return Boolean(from.field.pk) && !to.field.pk && isKey(to.field, to.table);
}

/** Swaps the two ends. Waypoints are stored in from→to order, so they're reversed too — the drawn line stays where it was. */
export function reverseRef(ref: Ref): Ref {
  const reversed: Ref = { ...ref, from: ref.to, to: ref.from };
  if (ref.routingPoints) reversed.routingPoints = [...ref.routingPoints].reverse();
  return reversed;
}

/** `project` with every certainly-inverted ref flipped (see `isRefInverted`). Same object back when nothing changes. */
export function normalizeRefOrientation(project: Project): Project {
  const tablesById = new Map(project.tables.map((t) => [t.id, t]));
  let changed = false;
  const refs = project.refs.map((ref) => {
    if (!isRefInverted(ref, tablesById)) return ref;
    changed = true;
    return reverseRef(ref);
  });
  return changed ? { ...project, refs } : project;
}
