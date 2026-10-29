import { describeDbmlParseError, diffProjects, parseDbml, toProject } from "@nebuladb/dbml-engine";
import type { Field, Project, Ref, Table } from "@nebuladb/shared";
import { ToolError } from "./client.js";

/** Parses DBML into the project model; a syntax error becomes a ToolError with its line and column. */
export function parseSchema(source: string, name = "schema"): Project {
  try {
    return toProject(parseDbml(source), name, source);
  } catch (err) {
    const info = describeDbmlParseError(err);
    const where = info.line !== undefined ? ` (line ${info.line}${info.column !== undefined ? `, column ${info.column}` : ""})` : "";
    throw new ToolError(`invalid DBML${where}: ${info.message.slice(0, 500)}`);
  }
}

export function qualifiedName(table: Table): string {
  return table.schemaName && table.schemaName !== "public" ? `${table.schemaName}.${table.name}` : table.name;
}

function describeType(field: Field): string {
  return field.type;
}

function fieldFlags(field: Field): string[] {
  const flags: string[] = [];
  if (field.pk) flags.push("pk");
  if (field.increment) flags.push("increment");
  if (field.unique) flags.push("unique");
  if (field.notNull) flags.push("not null");
  if (field.default !== undefined) flags.push(`default ${field.default}`);
  return flags;
}

export interface TableInfo {
  name: string;
  note?: string;
  columns: { name: string; type: string; flags: string[]; note?: string }[];
  indexes: { name?: string; columns: string[]; unique: boolean; pk: boolean }[];
  refs: string[];
}

function refLabel(project: Project, ref: Ref): string {
  const endpoint = (e: Ref["from"]) => {
    const table = project.tables.find((t) => t.id === e.tableId);
    const field = table?.fields.find((f) => f.id === e.fieldId);
    return table ? `${qualifiedName(table)}.${field?.name ?? "?"}` : "?";
  };
  const arrow = ref.cardinality === "one-to-one" ? "-" : ref.cardinality === "many-to-many" ? "<>" : ">";
  const actions = [ref.onDelete && `on delete ${ref.onDelete}`, ref.onUpdate && `on update ${ref.onUpdate}`].filter(Boolean);
  return `${endpoint(ref.from)} ${arrow} ${endpoint(ref.to)}${actions.length ? ` [${actions.join(", ")}]` : ""}`;
}

function findTable(project: Project, name: string): Table | undefined {
  const wanted = name.trim().toLowerCase();
  return (
    project.tables.find((t) => qualifiedName(t).toLowerCase() === wanted) ??
    project.tables.find((t) => t.name.toLowerCase() === wanted)
  );
}

export function describeTable(project: Project, name: string): TableInfo {
  const table = findTable(project, name);
  if (!table) {
    const known = project.tables.slice(0, 20).map(qualifiedName).join(", ");
    throw new ToolError(`no table named "${name}" in this project${known ? ` (known: ${known}${project.tables.length > 20 ? ", ..." : ""})` : ""}`);
  }
  const fieldName = (id: string) => table.fields.find((f) => f.id === id)?.name ?? id;
  return {
    name: qualifiedName(table),
    ...(table.note ? { note: table.note } : {}),
    columns: table.fields.map((f) => ({
      name: f.name,
      type: describeType(f),
      flags: fieldFlags(f),
      ...(f.note ? { note: f.note } : {}),
    })),
    indexes: table.indexes.map((i) => ({
      ...(i.name ? { name: i.name } : {}),
      columns: i.fieldIds.map(fieldName),
      unique: !!i.unique,
      pk: !!i.pk,
    })),
    refs: project.refs.filter((r) => r.from.tableId === table.id || r.to.tableId === table.id).map((r) => refLabel(project, r)),
  };
}

export interface SearchHit {
  kind: "table" | "column";
  table: string;
  column?: string;
  type?: string;
}

export function searchSchema(project: Project, query: string, limit = 50): { hits: SearchHit[]; truncated: boolean } {
  const q = query.trim().toLowerCase();
  const hits: SearchHit[] = [];
  if (!q) return { hits, truncated: false };
  for (const table of project.tables) {
    const tableName = qualifiedName(table);
    if (tableName.toLowerCase().includes(q)) hits.push({ kind: "table", table: tableName });
    for (const field of table.fields) {
      if (field.name.toLowerCase().includes(q)) hits.push({ kind: "column", table: tableName, column: field.name, type: field.type });
    }
  }
  return { hits: hits.slice(0, limit), truncated: hits.length > limit };
}

/** Ids from the parser are counters that differ between two inputs: key everything by name so the diff compares meaning. */
function normalizeIds(project: Project): Project {
  const tableKey = new Map<string, string>();
  const fieldKey = new Map<string, string>();
  for (const table of project.tables) {
    const key = qualifiedName(table);
    tableKey.set(table.id, key);
    for (const field of table.fields) fieldKey.set(`${table.id}\u0000${field.id}`, `${key}.${field.name}`);
  }
  const endpoint = (e: Ref["from"]) => ({
    tableId: tableKey.get(e.tableId) ?? e.tableId,
    fieldId: fieldKey.get(`${e.tableId}\u0000${e.fieldId}`) ?? e.fieldId,
  });
  return {
    ...project,
    tables: project.tables.map((t) => ({
      ...t,
      id: tableKey.get(t.id)!,
      fields: t.fields.map((f) => ({ ...f, id: fieldKey.get(`${t.id}\u0000${f.id}`)! })),
    })),
    refs: project.refs.map((r) => {
      const from = endpoint(r.from);
      const to = endpoint(r.to);
      return { ...r, id: `${from.fieldId}->${to.fieldId}`, from, to };
    }),
  };
}

export function diffSchemas(beforeSource: string, afterSource: string): string {
  const before = normalizeIds(parseSchema(beforeSource, "before"));
  const after = normalizeIds(parseSchema(afterSource, "after"));
  const diff = diffProjects(before, after);
  const nameOf = (project: Project, tableId: string) => project.tables.find((t) => t.id === tableId)?.name ?? tableId;
  const lines: string[] = [];
  for (const table of diff.tables) {
    if (table.status === "added") lines.push(`+ table ${table.name}`);
    else if (table.status === "removed") lines.push(`- table ${table.name}`);
    else {
      lines.push(`~ table ${table.name}`);
      for (const f of table.fields) {
        if (f.status === "added") lines.push(`    + ${f.name} ${f.after?.type ?? ""}`.trimEnd());
        else if (f.status === "removed") lines.push(`    - ${f.name} ${f.before?.type ?? ""}`.trimEnd());
        else lines.push(`    ~ ${f.name}: ${summarizeField(f.before)} -> ${summarizeField(f.after)}`);
      }
    }
  }
  for (const ref of diff.refs) {
    const side = ref.after ?? ref.before;
    if (!side) continue;
    const project = ref.after ? after : before;
    const label = `${nameOf(project, side.from.tableId)}.${side.from.fieldId.split(".").pop()} -> ${nameOf(project, side.to.tableId)}.${side.to.fieldId.split(".").pop()}`;
    lines.push(`${ref.status === "added" ? "+" : ref.status === "removed" ? "-" : "~"} ref ${label}`);
  }
  if (lines.length === 0) return "No structural difference (tables, columns, refs).";
  return lines.join("\n") + "\n\nNote: a renamed table or column shows up as removed + added.";
}

function summarizeField(field: Field | undefined): string {
  if (!field) return "?";
  return [field.type, ...fieldFlags(field)].join(" ");
}

/** Caps a text at `max` characters, saying so, so an agent never swallows a huge schema by accident. */
export function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[... truncated: ${text.length - max} more characters. Use get_table or search to read the part you need.]`;
}
