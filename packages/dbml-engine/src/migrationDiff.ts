import type { Field, Project, Ref, Table, TableIndex } from "@nebuladb/shared";

export type MigrationChangeStatus = "added" | "dropped" | "modified";

export interface MigrationFieldChange {
  name: string;
  status: MigrationChangeStatus;
  before?: Field;
  after?: Field;
  typeChanged?: boolean;
  notNullChanged?: boolean;
  defaultChanged?: boolean;
  pkChanged?: boolean;
  uniqueChanged?: boolean;
}

export interface MigrationTableChange {
  name: string;
  status: MigrationChangeStatus;
  before?: Table;
  after?: Table;
  fields: MigrationFieldChange[];
  addedIndexes: TableIndex[];
  droppedIndexes: TableIndex[];
}

export interface MigrationRefChange {
  name?: string;
  fromTable: string;
  fromField: string;
  toTable: string;
  toField: string;
  status: MigrationChangeStatus;
  before?: Ref;
  after?: Ref;
}

export interface MigrationDiff {
  tables: MigrationTableChange[];
  refs: MigrationRefChange[];
  hasChanges: boolean;
}

function normalizeType(t: string | undefined): string {
  if (!t) return "";
  return t.toLowerCase().trim().replace(/\s+/g, " ");
}

function typesMatch(a: string, b: string): boolean {
  const normA = normalizeType(a);
  const normB = normalizeType(b);
  if (normA === normB) return true;

  // `varchar(320)` and `varchar(255)` are one alias group but not one type:
  // when both sides spell out their size / precision, it has to agree. Only
  // when both do — one side without parameters (`int` against MySQL's
  // `int(11)`, `varchar` against `varchar(255)`) stays a match, as before.
  const paramsA = /\(([^)]*)\)/.exec(normA)?.[1]?.replace(/\s+/g, "");
  const paramsB = /\(([^)]*)\)/.exec(normB)?.[1]?.replace(/\s+/g, "");
  if (paramsA !== undefined && paramsB !== undefined && paramsA !== paramsB) return false;

  // Dialect type aliases
  const aliases: Record<string, string[]> = {
    int: ["integer", "int4", "int"],
    // BigQuery has one integer type: every integer column reads back as `int64`.
    bigint: ["int8", "bigint", "int64"],
    smallint: ["int2", "smallint", "int64"],
    bool: ["boolean", "bool", "tinyint(1)", "bit"],
    text: ["varchar", "character varying", "text", "string", "nvarchar"],
    // Live introspection reports the bare `decimal` (no precision/scale), like `varchar` without a length.
    decimal: ["decimal", "numeric"],
    float: ["real", "float4", "float"],
    double: ["double precision", "float8", "double", "float64"],
    binary: ["bytea", "blob", "binary", "varbinary", "bytes"],
    timestamp: ["timestamptz", "timestamp with time zone", "timestamp without time zone", "datetime"],
  };

  for (const group of Object.values(aliases)) {
    const matchA = group.some((g) => normA.startsWith(g));
    const matchB = group.some((g) => normB.startsWith(g));
    if (matchA && matchB) return true;
  }

  return false;
}

/**
 * Is this default "the current date and time", in any engine's spelling
 * (`GETDATE()`, `now()`, `CURRENT_TIMESTAMP`, BigQuery's `CURRENT_DATETIME()`…)?
 * The generator writes the spelling of the target engine, so the database
 * reads back another one than the schema wrote: they are the same default.
 */
export function isCurrentTimeExpression(text: string): boolean {
  const bare = text
    .trim()
    .replace(/^\((.*)\)$/, "$1")
    .trim()
    .toLowerCase();
  return /^(getdate|sysdatetime|now|current_timestamp|current_datetime|localtimestamp|sysdate|systimestamp)(\(\))?$/.test(
    bare,
  );
}

function normalizeDefault(d: string | undefined): string {
  if (!d) return "";
  let val = d.trim();
  // Strip quotes or casts like 'val'::text or ("val")
  if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
  if (val.startsWith("(") && val.endsWith(")")) val = val.slice(1, -1);
  if (isCurrentTimeExpression(val)) return "now";
  return val.toLowerCase();
}

function defaultsMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return normalizeDefault(a) === normalizeDefault(b);
}

/**
 * A primary-key column is implicitly NOT NULL on the database side, but the
 * model doesn't always say so: a composite PK is only expressed through the
 * table's `pk` index (its `fields` carry no per-field flag), and a single
 * `id int [pk]` needn't spell out `not null`. Without folding that in, every
 * PK column shows up as a NOT NULL -> NULL change, which the database rejects
 * anyway (a PK column can't be made nullable).
 */
function withImplicitPkFlags(table: Table): Field[] {
  const pkIds = new Set(table.indexes.filter((i) => i.pk).flatMap((i) => i.fieldIds));
  return table.fields.map((f) => (pkIds.has(f.id) || f.pk ? { ...f, pk: true, notNull: true } : f));
}

function diffFieldsByName(beforeTable: Table, afterTable: Table): MigrationFieldChange[] {
  const beforeFields = withImplicitPkFlags(beforeTable);
  const afterFields = withImplicitPkFlags(afterTable);
  const beforeByName = new Map(beforeFields.map((f) => [f.name.toLowerCase(), f]));
  const afterByName = new Map(afterFields.map((f) => [f.name.toLowerCase(), f]));
  const names = new Set([...beforeByName.keys(), ...afterByName.keys()]);

  const changes: MigrationFieldChange[] = [];

  for (const name of names) {
    const b = beforeByName.get(name);
    const a = afterByName.get(name);

    if (b && !a) {
      changes.push({
        name: b.name,
        status: "dropped",
        before: b,
      });
    } else if (!b && a) {
      changes.push({
        name: a.name,
        status: "added",
        after: a,
      });
    } else if (b && a) {
      const typeChanged = !typesMatch(b.type, a.type);
      const notNullChanged = !!b.notNull !== !!a.notNull;
      // `now()` the expression vs `'now()'` the string is a real change — but
      // only knowable when both sides say which they are (a live database's
      // introspected defaults, and older data, carry no kind).
      const kindChanged = b.defaultKind !== undefined && a.defaultKind !== undefined && b.defaultKind !== a.defaultKind;
      const defaultChanged = !defaultsMatch(b.default, a.default) || kindChanged;
      const pkChanged = !!b.pk !== !!a.pk;
      const uniqueChanged = !!b.unique !== !!a.unique;

      if (typeChanged || notNullChanged || defaultChanged || pkChanged || uniqueChanged) {
        changes.push({
          name: a.name,
          status: "modified",
          before: b,
          after: a,
          typeChanged,
          notNullChanged,
          defaultChanged,
          pkChanged,
          uniqueChanged,
        });
      }
    }
  }

  return changes;
}

function getIndexSignature(table: Table, idx: TableIndex): string {
  const fieldNames = idx.fieldIds.map(
    (id) => table.fields.find((f) => f.id === id)?.name.toLowerCase() ?? id.toLowerCase(),
  );
  return `${fieldNames.sort().join(",")}:${idx.unique ? "u" : "nu"}:${idx.pk ? "pk" : "npk"}`;
}

function diffIndexes(beforeTable: Table, afterTable: Table): { added: TableIndex[]; dropped: TableIndex[] } {
  // A composite PK is already diffed field by field (see `withImplicitPkFlags`). As an index it would
  // only ever show up as "added" (introspection reports the PK per column, never as an index) and
  // generate a redundant plain CREATE INDEX on top of the real primary key.
  const beforeSigs = new Map(
    beforeTable.indexes.filter((idx) => !idx.pk).map((idx) => [getIndexSignature(beforeTable, idx), idx]),
  );
  const afterSigs = new Map(
    afterTable.indexes.filter((idx) => !idx.pk).map((idx) => [getIndexSignature(afterTable, idx), idx]),
  );

  const added: TableIndex[] = [];
  const dropped: TableIndex[] = [];

  for (const [sig, idx] of afterSigs) {
    if (!beforeSigs.has(sig)) added.push(idx);
  }
  for (const [sig, idx] of beforeSigs) {
    if (!afterSigs.has(sig)) dropped.push(idx);
  }

  return { added, dropped };
}

function getRefSignature(
  project: Project,
  ref: Ref,
): { key: string; fromTable: string; fromField: string; toTable: string; toField: string } | null {
  const fromTable = project.tables.find((t) => t.id === ref.from.tableId);
  const toTable = project.tables.find((t) => t.id === ref.to.tableId);
  if (!fromTable || !toTable) return null;

  const fromField = fromTable.fields.find((f) => f.id === ref.from.fieldId)?.name ?? ref.from.fieldId;
  const toField = toTable.fields.find((f) => f.id === ref.to.fieldId)?.name ?? ref.to.fieldId;

  return {
    key: `${fromTable.name.toLowerCase()}.${fromField.toLowerCase()}->${toTable.name.toLowerCase()}.${toField.toLowerCase()}`,
    fromTable: fromTable.name,
    fromField,
    toTable: toTable.name,
    toField,
  };
}

/**
 * Computes a name-matched schema difference between a live database Project (`liveDbProject`)
 * and the desired target state in the editor (`targetProject`).
 */
export function diffTargetAgainstLive(liveDbProject: Project, targetProject: Project): MigrationDiff {
  const liveTablesByName = new Map(liveDbProject.tables.map((t) => [t.name.toLowerCase(), t]));
  const targetTablesByName = new Map(targetProject.tables.map((t) => [t.name.toLowerCase(), t]));
  const allTableNames = new Set([...liveTablesByName.keys(), ...targetTablesByName.keys()]);

  const tables: MigrationTableChange[] = [];

  for (const tableName of allTableNames) {
    const live = liveTablesByName.get(tableName);
    const target = targetTablesByName.get(tableName);

    if (live && !target) {
      tables.push({
        name: live.name,
        status: "dropped",
        before: live,
        fields: [],
        addedIndexes: [],
        droppedIndexes: [],
      });
    } else if (!live && target) {
      tables.push({
        name: target.name,
        status: "added",
        after: target,
        fields: target.fields.map((f) => ({ name: f.name, status: "added", after: f })),
        addedIndexes: target.indexes,
        droppedIndexes: [],
      });
    } else if (live && target) {
      const fieldChanges = diffFieldsByName(live, target);
      const indexChanges = diffIndexes(live, target);

      if (fieldChanges.length > 0 || indexChanges.added.length > 0 || indexChanges.dropped.length > 0) {
        tables.push({
          name: target.name,
          status: "modified",
          before: live,
          after: target,
          fields: fieldChanges,
          addedIndexes: indexChanges.added,
          droppedIndexes: indexChanges.dropped,
        });
      }
    }
  }

  // Ref diffing
  const liveRefMap = new Map<
    string,
    { ref: Ref; fromTable: string; fromField: string; toTable: string; toField: string }
  >();
  for (const r of liveDbProject.refs) {
    const sig = getRefSignature(liveDbProject, r);
    if (sig) liveRefMap.set(sig.key, { ref: r, ...sig });
  }

  const targetRefMap = new Map<
    string,
    { ref: Ref; fromTable: string; fromField: string; toTable: string; toField: string }
  >();
  for (const r of targetProject.refs) {
    const sig = getRefSignature(targetProject, r);
    if (sig) targetRefMap.set(sig.key, { ref: r, ...sig });
  }

  const allRefKeys = new Set([...liveRefMap.keys(), ...targetRefMap.keys()]);
  const refs: MigrationRefChange[] = [];

  for (const key of allRefKeys) {
    const live = liveRefMap.get(key);
    const target = targetRefMap.get(key);

    if (live && !target) {
      refs.push({
        name: live.ref.name,
        fromTable: live.fromTable,
        fromField: live.fromField,
        toTable: live.toTable,
        toField: live.toField,
        status: "dropped",
        before: live.ref,
      });
    } else if (!live && target) {
      refs.push({
        name: target.ref.name,
        fromTable: target.fromTable,
        fromField: target.fromField,
        toTable: target.toTable,
        toField: target.toField,
        status: "added",
        after: target.ref,
      });
    }
  }

  const hasChanges = tables.length > 0 || refs.length > 0;
  return { tables, refs, hasChanges };
}
