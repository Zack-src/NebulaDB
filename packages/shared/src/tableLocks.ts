import type { Field, Id, Ref, Table } from "./schema.js";

/**
 * `structure`: columns, types, constraints, indexes, the table's name and its
 * existence are frozen. `full`: the same, plus the table's initial data once
 * seeds exist (Phase 33) — until then the two levels are enforced alike, and
 * the level is recorded so a lock taken today keeps its meaning.
 *
 * Neither level freezes how the table *looks*: position, size, colour, detail
 * level and comments stay editable, since they change nothing in a database.
 */
export type TableLockLevel = "structure" | "full";

export const TABLE_LOCK_LEVELS: readonly TableLockLevel[] = ["structure", "full"];

/**
 * Who may change a locked table, and lift the lock. `project`: the project's
 * administrators (and instance administrators). `instance`: instance
 * administrators only — a lock a project administrator cannot undo.
 */
export type TableLockAuthority = "project" | "instance";

export const TABLE_LOCK_AUTHORITIES: readonly TableLockAuthority[] = ["project", "instance"];

export interface TableLock {
  projectId: Id;
  /** The table's id in the project document — stable across renames, DBML round trips and history restores. */
  tableId: Id;
  /** The name when the lock was last written; the live name comes from the project. Kept so a lock still reads sensibly in the audit trail. */
  tableName: string;
  level: TableLockLevel;
  authority: TableLockAuthority;
  reason: string | null;
  lockedBy: string | null;
  lockedByName: string | null;
  lockedAt: string;
}

/** `GET /api/projects/:id/locks`. */
export interface TableLocksResponse {
  locks: TableLock[];
  /** The highest authority the caller holds on this project's locks, or `null` when they can only read them. */
  canManage: TableLockAuthority | null;
}

export const TABLE_LOCK_REASON_MAX = 300;

/** The part of a project a lock is checked against. */
export interface LockableSchema {
  tables: readonly Table[];
  refs: readonly Ref[];
}

export type LockViolationKind = "changed" | "removed";

export interface LockViolation {
  tableId: Id;
  tableName: string;
  kind: LockViolationKind;
}

function fieldSignature(field: Field) {
  return [
    field.name,
    field.type,
    Boolean(field.pk),
    Boolean(field.unique),
    Boolean(field.notNull),
    Boolean(field.increment),
    field.default ?? null,
    field.defaultKind ?? null,
    field.note ?? "",
  ];
}

/**
 * What a lock protects, as a comparable string. Built from **names**, never
 * ids: a column keeps its name but gets a new id when the table goes through
 * the DBML text or a pull from a database, and that must not read as a change.
 * Column and index order are part of it — they are part of the DDL.
 */
export function tableStructureSignature(table: Table): string {
  const fieldNames = new Map(table.fields.map((field) => [field.id, field.name]));
  return JSON.stringify({
    name: table.name,
    schema: table.schemaName ?? "",
    note: table.note ?? "",
    fields: table.fields.map(fieldSignature),
    indexes: table.indexes.map((index) => [
      index.fieldIds.map((id) => fieldNames.get(id) ?? id),
      Boolean(index.unique),
      Boolean(index.pk),
      index.name ?? "",
    ]),
  });
}

interface OutgoingRef {
  fromField: string;
  toTable: Id;
  toFieldId: Id;
  toField: string;
  rest: string;
}

/**
 * The foreign keys each table *carries* (`ref.from` is the FK column, see
 * `refOrientation.ts`). Relations merely pointing **at** a locked table are
 * not its own: another table gaining a foreign key to `users` does not alter
 * `users`.
 */
function outgoingRefs(schema: LockableSchema): Map<Id, OutgoingRef[]> {
  const tables = new Map(schema.tables.map((table) => [table.id, table]));
  const fieldName = (id: Id, owner: Id) => tables.get(owner)?.fields.find((field) => field.id === id)?.name ?? id;
  const byTable = new Map<Id, OutgoingRef[]>();
  for (const ref of schema.refs) {
    const list = byTable.get(ref.from.tableId) ?? [];
    list.push({
      fromField: fieldName(ref.from.fieldId, ref.from.tableId),
      // By id: renaming the table a locked one points at does not change the locked one.
      toTable: ref.to.tableId,
      toFieldId: ref.to.fieldId,
      toField: fieldName(ref.to.fieldId, ref.to.tableId),
      rest: JSON.stringify([ref.cardinality, ref.onDelete ?? "", ref.onUpdate ?? "", ref.name ?? ""]),
    });
    byTable.set(ref.from.tableId, list);
  }
  return byTable;
}

/**
 * Same foreign keys on both sides, in any order. The target column matches by
 * id **or** by name: its id survives a rename made on the canvas, its name
 * survives a trip through the DBML text (which hands out new column ids).
 */
function sameOutgoingRefs(before: OutgoingRef[] = [], after: OutgoingRef[] = []): boolean {
  if (before.length !== after.length) return false;
  const remaining = [...after];
  for (const ref of before) {
    const index = remaining.findIndex(
      (candidate) =>
        candidate.fromField === ref.fromField &&
        candidate.toTable === ref.toTable &&
        candidate.rest === ref.rest &&
        (candidate.toFieldId === ref.toFieldId || candidate.toField === ref.toField),
    );
    if (index === -1) return false;
    remaining.splice(index, 1);
  }
  return true;
}

/**
 * The locked tables a change from `before` to `after` would alter or remove.
 * Empty when the change is allowed.
 *
 * One function for every write path — the realtime room, DBML / SQL import,
 * history restore, pull from a database — so "what counts as touching a locked
 * table" has a single definition.
 */
export function findLockViolations(
  before: LockableSchema,
  after: LockableSchema,
  lockedTableIds: Iterable<Id>,
): LockViolation[] {
  const locked = new Set(lockedTableIds);
  if (locked.size === 0) return [];
  const afterTables = new Map(after.tables.map((table) => [table.id, table]));
  const refsBefore = outgoingRefs(before);
  const refsAfter = outgoingRefs(after);
  const violations: LockViolation[] = [];
  for (const table of before.tables) {
    if (!locked.has(table.id)) continue;
    const next = afterTables.get(table.id);
    if (!next) {
      violations.push({ tableId: table.id, tableName: table.name, kind: "removed" });
    } else if (
      // Same object: untouched, as is nearly every table on nearly every realtime frame.
      (next !== table && tableStructureSignature(next) !== tableStructureSignature(table)) ||
      !sameOutgoingRefs(refsBefore.get(table.id), refsAfter.get(table.id))
    ) {
      violations.push({ tableId: table.id, tableName: table.name, kind: "changed" });
    }
  }
  return violations;
}

/**
 * `after`, with every violated table put back the way it was in `before` —
 * structure and outgoing relations — while keeping whatever else `after`
 * changed, including the locked tables' own position, colour and comments.
 *
 * For the one write path that cannot refuse a change up front: a realtime
 * update has already been merged into the shared document by the time it can
 * be inspected.
 */
export function revertLockViolations<T extends LockableSchema>(
  before: LockableSchema,
  after: T,
  violations: readonly LockViolation[],
): { tables: Table[]; refs: Ref[] } {
  const violated = new Set(violations.map((violation) => violation.tableId));
  const beforeTables = new Map(before.tables.map((table) => [table.id, table]));
  const afterTables = new Map(after.tables.map((table) => [table.id, table]));

  const tables = after.tables.map((table) => {
    const previous = violated.has(table.id) ? beforeTables.get(table.id) : undefined;
    if (!previous) return table;
    // The previous structure, under the current looks.
    return {
      ...previous,
      position: table.position,
      size: table.size,
      style: table.style,
      detailLevel: table.detailLevel,
      comments: table.comments,
    };
  });
  for (const id of violated) {
    const previous = beforeTables.get(id);
    if (previous && !afterTables.has(id)) tables.push(previous);
  }

  const refs = [
    ...after.refs.filter((ref) => !violated.has(ref.from.tableId)),
    ...before.refs.filter((ref) => violated.has(ref.from.tableId)),
  ];
  return { tables, refs };
}
