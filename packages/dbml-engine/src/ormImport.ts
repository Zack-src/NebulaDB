import type { EnumDef, Field, Project, Ref, RefAction, Table, TableIndex } from "@nebuladb/shared";
import { projectToDbml } from "./serialize.js";

/** A non-fatal problem met while importing an ORM schema: the construct is skipped or approximated, the import goes on. */
export interface ImportWarning {
  message: string;
  /** 1-based source line when known. */
  line?: number;
}

/**
 * Result of every ORM/schema-file importer (`importPrisma`, `importDrizzle`).
 * Importers never throw on partial or malformed input: whatever could be
 * understood is in `project`, and what could not is listed in `warnings`.
 */
export interface OrmImportResult {
  project: Project;
  /** `project` as DBML text, ready for the editor (the plugin import currency). Empty if serialization failed (see warnings). */
  dbml: string;
  warnings: ImportWarning[];
}

export interface OrmImportOptions {
  projectName?: string;
}

// ---------------------------------------------------------------------------
// Intermediate representation shared by the importers.
// ---------------------------------------------------------------------------

export interface IrColumn {
  name: string;
  type: string;
  pk?: boolean;
  unique?: boolean;
  notNull?: boolean;
  increment?: boolean;
  default?: string;
  defaultKind?: Field["defaultKind"];
  note?: string;
}

export interface IrIndex {
  name?: string;
  columns: string[];
  unique?: boolean;
  pk?: boolean;
}

export interface IrForeignKey {
  name?: string;
  columns: string[];
  refTable: string;
  refSchema?: string;
  refColumns: string[];
  onDelete?: RefAction;
  onUpdate?: RefAction;
}

export interface IrTable {
  name: string;
  schema?: string;
  note?: string;
  columns: IrColumn[];
  indexes: IrIndex[];
  foreignKeys: IrForeignKey[];
}

export interface IrEnum {
  name: string;
  values: string[];
}

export interface IrSchema {
  tables: IrTable[];
  enums: IrEnum[];
}

const tableKey = (name: string, schema?: string) => (schema ? `${schema}.${name}` : name);

/** Builds the NebulaDB `Project` from an importer's IR. Unresolvable references become warnings. */
export function buildProject(ir: IrSchema, projectName: string, warnings: ImportWarning[]): Project {
  const tables: Table[] = [];
  const tableByKey = new Map<string, Table>();

  ir.tables.forEach((t, index) => {
    const id = `table:${tableKey(t.name, t.schema)}`;
    if (tableByKey.has(tableKey(t.name, t.schema))) {
      warnings.push({ message: `Duplicate table "${t.name}" ignored.` });
      return;
    }
    const seen = new Set<string>();
    const fields: Field[] = [];
    for (const c of t.columns) {
      if (seen.has(c.name)) {
        warnings.push({ message: `Duplicate column "${t.name}.${c.name}" ignored.` });
        continue;
      }
      seen.add(c.name);
      const f: Field = { id: `${id}.${c.name}`, name: c.name, type: c.type };
      if (c.pk) f.pk = true;
      if (c.unique) f.unique = true;
      if (c.notNull || c.pk) f.notNull = true;
      if (c.increment) f.increment = true;
      if (c.default !== undefined) {
        f.default = c.default;
        if (c.defaultKind) f.defaultKind = c.defaultKind;
      }
      if (c.note) f.note = c.note;
      fields.push(f);
    }
    const fieldId = (name: string) => fields.find((f) => f.name === name)?.id;
    const indexes: TableIndex[] = [];
    t.indexes.forEach((idx, i) => {
      const ids = idx.columns.map(fieldId);
      if (ids.length === 0 || ids.some((x) => x === undefined)) {
        warnings.push({
          message: `Index on "${t.name}" (${idx.columns.join(", ")}) references an unknown column and was skipped.`,
        });
        return;
      }
      const ti: TableIndex = { id: `${id}.idx${i}`, fieldIds: ids as string[] };
      if (idx.unique) ti.unique = true;
      if (idx.pk) ti.pk = true;
      if (idx.name) ti.name = idx.name;
      indexes.push(ti);
    });
    const table: Table = {
      id,
      name: t.name,
      fields,
      indexes,
      position: { x: (index % 6) * 320, y: Math.floor(index / 6) * 400 },
      detailLevel: "standard",
    };
    if (t.schema) table.schemaName = t.schema;
    if (t.note) table.note = t.note;
    tables.push(table);
    tableByKey.set(tableKey(t.name, t.schema), table);
  });

  const refs: Ref[] = [];
  for (const t of ir.tables) {
    const owner = tableByKey.get(tableKey(t.name, t.schema));
    if (!owner) continue;
    for (const fk of t.foreignKeys) {
      const target =
        tableByKey.get(tableKey(fk.refTable, fk.refSchema)) ??
        (fk.refSchema ? undefined : tableByKey.get(tableKey(fk.refTable, t.schema)));
      if (!target) {
        warnings.push({ message: `Foreign key on "${t.name}" targets unknown table "${fk.refTable}"; skipped.` });
        continue;
      }
      if (fk.columns.length === 0 || fk.columns.length !== fk.refColumns.length) {
        warnings.push({ message: `Foreign key on "${t.name}" to "${fk.refTable}" has mismatched columns; skipped.` });
        continue;
      }
      if (fk.columns.length > 1) {
        warnings.push({
          message: `Composite foreign key ${t.name}(${fk.columns.join(", ")}) -> ${fk.refTable}(${fk.refColumns.join(", ")}) is split into one reference per column pair.`,
        });
      }
      fk.columns.forEach((col, i) => {
        const from = owner.fields.find((f) => f.name === col);
        const to = target.fields.find((f) => f.name === fk.refColumns[i]);
        if (!from || !to) {
          warnings.push({
            message: `Foreign key ${t.name}.${col} -> ${fk.refTable}.${fk.refColumns[i]} references an unknown column; skipped.`,
          });
          return;
        }
        const ref: Ref = {
          id: `ref:${refs.length}`,
          from: { tableId: owner.id, fieldId: from.id },
          to: { tableId: target.id, fieldId: to.id },
          cardinality: isUniqueOwnerColumns(t, fk.columns) ? "one-to-one" : "one-to-many",
        };
        if (fk.name) ref.name = fk.name;
        if (fk.onDelete) ref.onDelete = fk.onDelete;
        if (fk.onUpdate) ref.onUpdate = fk.onUpdate;
        refs.push(ref);
      });
    }
  }

  const enumRow = Math.ceil(tables.length / 6) + 1;
  const enums: EnumDef[] = ir.enums.map((e, i) => ({
    id: `enum:${e.name}`,
    name: e.name,
    values: e.values.map((v, vi) => ({ id: `enum:${e.name}.${vi}`, name: v })),
    position: { x: (i % 6) * 320, y: (enumRow + Math.floor(i / 6)) * 400 },
  }));

  return {
    id: crypto.randomUUID(),
    name: projectName,
    tables,
    refs,
    enums,
    zones: [],
    stickyNotes: [],
    tableGroups: [],
  };
}

/** True when `columns` alone are the whole primary key or a whole unique constraint of the table. */
function isUniqueOwnerColumns(t: IrTable, columns: string[]): boolean {
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  if (columns.length === 1) {
    const c = t.columns.find((x) => x.name === columns[0]);
    if (c && (c.unique || (c.pk && t.columns.filter((x) => x.pk).length === 1))) return true;
  }
  return t.indexes.some((i) => (i.unique || i.pk) && same(i.columns, columns));
}

/** Packages an IR into the public result: builds the project and its DBML, never throwing. */
export function finishImport(
  ir: IrSchema,
  projectName: string | undefined,
  warnings: ImportWarning[],
  defaultName: string,
): OrmImportResult {
  const project = buildProject(ir, projectName ?? defaultName, warnings);
  let dbml = "";
  try {
    dbml = projectToDbml(project);
  } catch (err) {
    warnings.push({ message: `DBML serialization failed: ${err instanceof Error ? err.message : String(err)}` });
  }
  return { project, dbml, warnings };
}

export function emptyResult(projectName: string | undefined, defaultName: string, warnings: ImportWarning[]) {
  return finishImport({ tables: [], enums: [] }, projectName, warnings, defaultName);
}
