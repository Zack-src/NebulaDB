import type { Field, Project, Ref } from "@athanordb/shared";

// Deliberately its own module with zero `@dbml/core` import — unlike dbml.ts
// (which instantiates a Parser at module scope, dragging that whole parser
// library into anything that imports even one export from it), this is pure
// Project-vs-Project diffing and is safe to import client-side.

export type ChangeStatus = "added" | "removed" | "changed";

export interface FieldDiff {
  id: string;
  name: string;
  status: ChangeStatus;
  before?: Field;
  after?: Field;
}

export interface TableDiff {
  id: string;
  name: string;
  status: ChangeStatus;
  renamedFrom?: string;
  fields: FieldDiff[];
}

export interface RefDiff {
  id: string;
  status: ChangeStatus;
  before?: Ref;
  after?: Ref;
}

export interface ProjectDiff {
  tables: TableDiff[];
  refs: RefDiff[];
}

function fieldsEqual(a: Field, b: Field): boolean {
  return (
    a.name === b.name &&
    a.type === b.type &&
    !!a.pk === !!b.pk &&
    !!a.unique === !!b.unique &&
    !!a.notNull === !!b.notNull &&
    !!a.increment === !!b.increment &&
    a.default === b.default &&
    // Older revisions carry no `defaultKind`: only a change between two known kinds counts.
    (a.defaultKind === undefined || b.defaultKind === undefined || a.defaultKind === b.defaultKind) &&
    a.note === b.note
  );
}

function refsEqual(a: Ref, b: Ref): boolean {
  return (
    a.from.tableId === b.from.tableId &&
    a.from.fieldId === b.from.fieldId &&
    a.to.tableId === b.to.tableId &&
    a.to.fieldId === b.to.fieldId &&
    a.cardinality === b.cardinality &&
    a.name === b.name
  );
}

function diffFields(before: Field[], after: Field[]): FieldDiff[] {
  const beforeById = new Map(before.map((f) => [f.id, f]));
  const afterById = new Map(after.map((f) => [f.id, f]));
  const ids = new Set([...beforeById.keys(), ...afterById.keys()]);

  const result: FieldDiff[] = [];
  for (const id of ids) {
    const b = beforeById.get(id);
    const a = afterById.get(id);
    if (b && !a) result.push({ id, name: b.name, status: "removed", before: b });
    else if (!b && a) result.push({ id, name: a.name, status: "added", after: a });
    else if (b && a && !fieldsEqual(b, a)) result.push({ id, name: a.name, status: "changed", before: b, after: a });
  }
  return result;
}

/**
 * Schema-level diff between two `Project`s, matched by entity id — the right
 * granularity for comparing two revisions of the *same* project's Yjs doc
 * (ids are stable across a doc's history), not for comparing an unrelated
 * reimport (`mergeProjectIntoExisting` matches by name for that case instead).
 * Only tables/fields/refs are covered, per the todo item's own scope — zones,
 * sticky notes, and enums are visual/auxiliary rather than schema.
 */
export function diffProjects(before: Project, after: Project): ProjectDiff {
  const beforeTablesById = new Map(before.tables.map((t) => [t.id, t]));
  const afterTablesById = new Map(after.tables.map((t) => [t.id, t]));
  const tableIds = new Set([...beforeTablesById.keys(), ...afterTablesById.keys()]);

  const tables: TableDiff[] = [];
  for (const id of tableIds) {
    const b = beforeTablesById.get(id);
    const a = afterTablesById.get(id);
    if (b && !a) {
      tables.push({ id, name: b.name, status: "removed", fields: [] });
    } else if (!b && a) {
      tables.push({ id, name: a.name, status: "added", fields: [] });
    } else if (b && a) {
      const fields = diffFields(b.fields, a.fields);
      const renamed = b.name !== a.name;
      if (fields.length > 0 || renamed) {
        tables.push({ id, name: a.name, status: "changed", renamedFrom: renamed ? b.name : undefined, fields });
      }
    }
  }

  const beforeRefsById = new Map(before.refs.map((r) => [r.id, r]));
  const afterRefsById = new Map(after.refs.map((r) => [r.id, r]));
  const refIds = new Set([...beforeRefsById.keys(), ...afterRefsById.keys()]);

  const refs: RefDiff[] = [];
  for (const id of refIds) {
    const b = beforeRefsById.get(id);
    const a = afterRefsById.get(id);
    if (b && !a) refs.push({ id, status: "removed", before: b });
    else if (!b && a) refs.push({ id, status: "added", after: a });
    else if (b && a && !refsEqual(b, a)) refs.push({ id, status: "changed", before: b, after: a });
  }

  return { tables, refs };
}
