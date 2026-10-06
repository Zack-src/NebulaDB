import type { Project } from "@nebuladb/shared";

// Zero `@dbml/core` import, like validate.ts and lint.ts: the editor's
// dictionary page and the server's export run the same functions.

/**
 * Data dictionary: what a table or a column *means* — a description, who
 * owns it, how sensitive it is, free tags.
 *
 * All of it lives in the element's DBML `Note`, so it follows the schema
 * wherever the schema goes (history, export, a pull request on the `.dbml`
 * file) with no second store to keep in step. The description is the note's
 * text; the rest are bracketed annotations after it:
 *
 *   'Customer accounts. [owner: crm-team] [class: personal] [tags: rgpd, core]'
 *
 * A note is one line of DBML, so a description is too.
 */
export const DATA_CLASSIFICATIONS = ["public", "internal", "personal", "sensitive"] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

export interface NoteMeta {
  description: string;
  owner?: string;
  classification?: DataClassification;
  tags: string[];
}

const ANNOTATION = /\[(owner|class|tags)\s*:\s*([^\]]*)\]/gi;
const MAX_VALUE = 80;

/** One line, no bracket: what an annotation's value may hold. */
const clean = (value: string) =>
  value
    .replace(/[[\]\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_VALUE);

export function parseNote(note: string | undefined): NoteMeta {
  const meta: NoteMeta = { description: "", tags: [] };
  const text = (note ?? "").replace(ANNOTATION, (_, key: string, raw: string) => {
    const value = raw.trim();
    switch (key.toLowerCase()) {
      case "owner":
        if (value) meta.owner = value;
        break;
      case "class": {
        const known = DATA_CLASSIFICATIONS.find((c) => c === value.toLowerCase());
        if (known) meta.classification = known;
        break;
      }
      default:
        meta.tags = [...new Set(value.split(",").map(clean).filter(Boolean))];
    }
    return "";
  });
  meta.description = text.replace(/\s+/g, " ").trim();
  return meta;
}

/** The note that says `meta`; `undefined` when there is nothing to say. */
export function formatNote(meta: NoteMeta): string | undefined {
  const parts = [meta.description.replace(/\s+/g, " ").trim()];
  const owner = clean(meta.owner ?? "");
  if (owner) parts.push(`[owner: ${owner}]`);
  if (meta.classification) parts.push(`[class: ${meta.classification}]`);
  const tags = [...new Set(meta.tags.map(clean).filter(Boolean))];
  if (tags.length > 0) parts.push(`[tags: ${tags.join(", ")}]`);
  return parts.filter(Boolean).join(" ") || undefined;
}

export interface DictionaryColumn extends NoteMeta {
  id: string;
  name: string;
  type: string;
  /** `pk`, `not null`, `unique`, `fk → table.column` — what a reader wants next to the type. */
  constraints: string[];
}

export interface DictionaryTable extends NoteMeta {
  id: string;
  name: string;
  schemaName?: string;
  columns: DictionaryColumn[];
}

/** A list of allowed values: what each one means, and which columns take them. */
export interface DictionaryEnum {
  id: string;
  name: string;
  values: { name: string; description: string }[];
  /** `table.column` of every column typed with this enum. */
  usedBy: string[];
}

export interface DataDictionary {
  projectName: string;
  tables: DictionaryTable[];
  /** By name. Not part of `completeness`: a value's name is often all there is to say. */
  enums: DictionaryEnum[];
  /** How much of the schema says what it is. */
  completeness: { tables: number; describedTables: number; columns: number; describedColumns: number };
}

/** `lint-ignore: …` is an instruction to the linter, not a description. */
const withoutLintAnnotation = (text: string) => text.replace(/lint-ignore:\s*[a-z0-9,\s-]+/gi, "").trim();

/** The dictionary of a project: tables by name, columns in their own order. */
export function buildDictionary(project: Project): DataDictionary {
  const tablesById = new Map(project.tables.map((table) => [table.id, table]));
  const foreignKeys = new Map<string, string>();
  for (const ref of project.refs) {
    const target = tablesById.get(ref.to.tableId);
    const column = target?.fields.find((field) => field.id === ref.to.fieldId);
    if (target && column) foreignKeys.set(`${ref.from.tableId}.${ref.from.fieldId}`, `${target.name}.${column.name}`);
  }

  const tables = [...project.tables]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((table): DictionaryTable => {
      const meta = parseNote(table.note);
      return {
        id: table.id,
        name: table.name,
        schemaName: table.schemaName,
        ...meta,
        description: withoutLintAnnotation(meta.description),
        columns: table.fields.map((field) => {
          const target = foreignKeys.get(`${table.id}.${field.id}`);
          return {
            id: field.id,
            name: field.name,
            type: field.type,
            constraints: [
              field.pk ? "pk" : "",
              field.notNull ? "not null" : "",
              field.unique ? "unique" : "",
              target ? `fk → ${target}` : "",
            ].filter(Boolean),
            ...parseNote(field.note),
          };
        }),
      };
    });

  // A column's type names its enum, with or without the schema in front (`status`, `shop.status`).
  const typeName = (type: string) => type.replace(/\[\]$/, "").split(".").pop()!.replace(/"/g, "").trim().toLowerCase();
  const enums = [...project.enums]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((def): DictionaryEnum => {
      const name = typeName(def.name);
      return {
        id: def.id,
        name: def.name,
        values: def.values.map((value) => ({ name: value.name, description: parseNote(value.note).description })),
        usedBy: tables.flatMap((table) =>
          table.columns
            .filter((column) => typeName(column.type) === name)
            .map((column) => `${table.name}.${column.name}`),
        ),
      };
    });

  const columns = tables.flatMap((table) => table.columns);
  return {
    projectName: project.name,
    tables,
    enums,
    completeness: {
      tables: tables.length,
      describedTables: tables.filter((table) => table.description).length,
      columns: columns.length,
      describedColumns: columns.filter((column) => column.description).length,
    },
  };
}

/** Share of tables and columns that have a description, 0–100; an empty schema is complete. */
export function completenessPercent(dictionary: DataDictionary): number {
  const { tables, describedTables, columns, describedColumns } = dictionary.completeness;
  const total = tables + columns;
  return total === 0 ? 100 : Math.round(((describedTables + describedColumns) / total) * 100);
}

const mdCell = (text: string) => text.replace(/\|/g, "\\|").replace(/\s+/g, " ");

export function dictionaryToMarkdown(dictionary: DataDictionary): string {
  const lines = [`# ${dictionary.projectName} — data dictionary`, ""];
  for (const table of dictionary.tables) {
    lines.push(`## ${table.schemaName ? `${table.schemaName}.` : ""}${table.name}`, "");
    if (table.description) lines.push(table.description, "");
    const facts = [
      table.owner ? `**Owner:** ${table.owner}` : "",
      table.classification ? `**Classification:** ${table.classification}` : "",
      table.tags.length > 0 ? `**Tags:** ${table.tags.join(", ")}` : "",
    ].filter(Boolean);
    if (facts.length > 0) lines.push(facts.join(" · "), "");
    lines.push("| Column | Type | Constraints | Classification | Description |", "| --- | --- | --- | --- | --- |");
    for (const column of table.columns) {
      const description = [column.description, column.tags.length > 0 ? `(${column.tags.join(", ")})` : ""]
        .filter(Boolean)
        .join(" ");
      lines.push(
        `| \`${column.name}\` | ${mdCell(column.type)} | ${mdCell(column.constraints.join(", "))} | ${
          column.classification ?? ""
        } | ${mdCell(description)} |`,
      );
    }
    lines.push("");
  }
  if (dictionary.enums.length > 0) lines.push("# Enums", "");
  for (const def of dictionary.enums) {
    lines.push(`## ${def.name}`, "");
    if (def.usedBy.length > 0) lines.push(`**Used by:** ${def.usedBy.map((column) => `\`${column}\``).join(", ")}`, "");
    lines.push("| Value | Description |", "| --- | --- |");
    for (const value of def.values) lines.push(`| \`${value.name}\` | ${mdCell(value.description)} |`);
    lines.push("");
  }
  return lines.join("\n");
}

/** A cell a spreadsheet will not run: text that looks like a formula is prefixed with `'`. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** One line per table (empty `column`) and per column. Enums are not in it: they have no place in these columns. */
export function dictionaryToCsv(dictionary: DataDictionary): string {
  const rows = [["table", "column", "type", "constraints", "description", "owner", "classification", "tags"]];
  for (const table of dictionary.tables) {
    rows.push([
      table.name,
      "",
      "",
      "",
      table.description,
      table.owner ?? "",
      table.classification ?? "",
      table.tags.join(" "),
    ]);
    for (const column of table.columns) {
      rows.push([
        table.name,
        column.name,
        column.type,
        column.constraints.join(" "),
        column.description,
        column.owner ?? "",
        column.classification ?? "",
        column.tags.join(" "),
      ]);
    }
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A single self-contained page: no script, no external resource — safe to open from disk or host as is. */
export function dictionaryToHtml(dictionary: DataDictionary): string {
  const e = escapeHtml;
  const badge = (classification?: DataClassification) =>
    classification ? `<span class="c c-${classification}">${classification}</span>` : "";
  const tables = dictionary.tables
    .map((table) => {
      const rows = table.columns
        .map(
          (column) =>
            `<tr><td><code>${e(column.name)}</code></td><td>${e(column.type)}</td><td>${e(
              column.constraints.join(", "),
            )}</td><td>${badge(column.classification)}</td><td>${e(column.description)}${
              column.tags.length > 0 ? ` <em>${e(column.tags.join(", "))}</em>` : ""
            }</td></tr>`,
        )
        .join("\n");
      const facts = [
        table.owner ? `Owner: ${e(table.owner)}` : "",
        table.tags.length > 0 ? `Tags: ${e(table.tags.join(", "))}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return `<section id="${e(table.name)}">
<h2>${e(table.schemaName ? `${table.schemaName}.${table.name}` : table.name)} ${badge(table.classification)}</h2>
${table.description ? `<p>${e(table.description)}</p>` : ""}
${facts ? `<p class="facts">${facts}</p>` : ""}
<table><thead><tr><th>Column</th><th>Type</th><th>Constraints</th><th>Classification</th><th>Description</th></tr></thead>
<tbody>
${rows}
</tbody></table>
</section>`;
    })
    .join("\n");
  const enums = dictionary.enums
    .map(
      (def) => `<section id="enum-${e(def.name)}">
<h3>${e(def.name)}</h3>
${def.usedBy.length > 0 ? `<p class="facts">Used by: ${e(def.usedBy.join(", "))}</p>` : ""}
<table><thead><tr><th>Value</th><th>Description</th></tr></thead>
<tbody>
${def.values.map((value) => `<tr><td><code>${e(value.name)}</code></td><td>${e(value.description)}</td></tr>`).join("\n")}
</tbody></table>
</section>`,
    )
    .join("\n");
  const nav = dictionary.tables.map((table) => `<a href="#${e(table.name)}">${e(table.name)}</a>`).join(" ");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${e(dictionary.projectName)} — data dictionary</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;margin:2rem auto;max-width:60rem;padding:0 1rem;color:#1f2933}
nav a{margin-right:.75rem}h2{margin-top:2.5rem;border-bottom:1px solid #d9dee4;padding-bottom:.25rem}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #d9dee4;padding:.3rem .5rem;text-align:left;vertical-align:top}
th{background:#f3f5f7}.facts{color:#52606d}.c{font-size:11px;border-radius:999px;padding:0 .5rem;border:1px solid}
.c-personal{color:#b45309}.c-sensitive{color:#b91c1c}.c-internal{color:#1d4ed8}.c-public{color:#15803d}
</style></head><body>
<h1>${e(dictionary.projectName)} — data dictionary</h1>
<p class="facts">${completenessPercent(dictionary)}% described — ${dictionary.completeness.tables} tables, ${
    dictionary.completeness.columns
  } columns.</p>
<nav>${nav}</nav>
${tables}
${enums ? `<h2>Enums</h2>\n${enums}` : ""}
</body></html>
`;
}

/**
 * A note as a reader should see it: the description, then what the
 * annotations say on a line of its own — never the raw `[owner: …]` syntax.
 * `undefined` for a note that says nothing.
 */
export function readableNote(note: string | undefined): string | undefined {
  if (!note) return undefined;
  const meta = parseNote(note);
  const facts = [meta.owner, meta.classification, meta.tags.join(", ")].filter(Boolean).join(" · ");
  return [meta.description, facts].filter(Boolean).join("\n") || undefined;
}
