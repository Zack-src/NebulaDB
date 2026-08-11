import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  snippetCompletion,
} from "@codemirror/autocomplete";
import { DBML_TYPES } from "@/features/editor/dbml/language";
import { getSymbols, tableAt, type DbmlSymbols } from "@/features/editor/dbml/symbols";

const REF_SETTINGS: Completion[] = [
  { label: "cascade", type: "keyword", detail: "ON … CASCADE" },
  { label: "restrict", type: "keyword", detail: "ON … RESTRICT" },
  { label: "set null", type: "keyword", detail: "ON … SET NULL" },
  { label: "set default", type: "keyword", detail: "ON … SET DEFAULT" },
  { label: "no action", type: "keyword", detail: "ON … NO ACTION" },
];

const COLUMN_SETTINGS: Completion[] = [
  { label: "pk", type: "keyword", detail: "Primary key", boost: 90 },
  { label: "primary key", type: "keyword", detail: "Primary key" },
  { label: "unique", type: "keyword", detail: "Unique constraint", boost: 80 },
  { label: "not null", type: "keyword", detail: "Disallow NULL", boost: 80 },
  { label: "null", type: "keyword", detail: "Allow NULL" },
  { label: "increment", type: "keyword", detail: "Auto-increment", boost: 70 },
  snippetCompletion("default: ${value}", { label: "default", type: "property", detail: "Default value" }),
  snippetCompletion("default: `${now()}`", { label: "default: `now()`", type: "property", detail: "SQL expression default" }),
  snippetCompletion("note: '${text}'", { label: "note", type: "property", detail: "Column note" }),
  snippetCompletion("ref: > ${Table}.${column}", { label: "ref", type: "property", detail: "Inline relationship" }),
];

const TABLE_SETTINGS: Completion[] = [
  snippetCompletion("headercolor: ${#6366F1}", { label: "headercolor", type: "property", detail: "Header colour" }),
  snippetCompletion("note: '${text}'", { label: "note", type: "property", detail: "Table note" }),
];

const TOP_LEVEL: Completion[] = [
  snippetCompletion(
    "Table ${name} {\n  id integer [pk, increment]\n  ${name} varchar [not null]\n  created_at timestamp [default: `now()`]\n}",
    { label: "Table", type: "keyword", detail: "table block", boost: 99 },
  ),
  snippetCompletion("Ref: ${Table1}.${col1} > ${Table2}.${col2}", {
    label: "Ref",
    type: "keyword",
    detail: "relationship",
    boost: 98,
  }),
  snippetCompletion("Enum ${name} {\n  ${value1}\n  ${value2}\n}", { label: "Enum", type: "keyword", detail: "enum block", boost: 97 }),
  snippetCompletion("TableGroup ${name} {\n  ${Table1}\n  ${Table2}\n}", {
    label: "TableGroup",
    type: "keyword",
    detail: "table group",
  }),
  snippetCompletion("Project ${name} {\n  database_type: '${PostgreSQL}'\n  Note: '${description}'\n}", {
    label: "Project",
    type: "keyword",
    detail: "project metadata",
  }),
  snippetCompletion("Note ${name} {\n  '''\n  ${text}\n  '''\n}", { label: "Note", type: "keyword", detail: "note block" }),
  snippetCompletion("indexes {\n  (${col1}, ${col2}) [name: '${idx_name}']\n}", {
    label: "indexes",
    type: "keyword",
    detail: "index block",
  }),
];

function tableCompletions(symbols: DbmlSymbols): Completion[] {
  return symbols.tables.map((t) => ({
    label: t.name,
    type: "class",
    detail: `table · ${t.fields.length} field${t.fields.length === 1 ? "" : "s"}`,
    info: t.note,
    boost: 40,
  }));
}

function qualifiedFieldCompletions(symbols: DbmlSymbols): Completion[] {
  const out: Completion[] = [];
  for (const t of symbols.tables) {
    for (const f of t.fields) {
      out.push({
        label: `${t.name}.${f.name}`,
        type: f.pk ? "constant" : "property",
        detail: f.type + (f.pk ? " · pk" : ""),
        info: f.note,
        boost: f.pk ? 30 : 10,
      });
    }
  }
  return out;
}

function typeCompletions(symbols: DbmlSymbols): Completion[] {
  return [
    ...DBML_TYPES.map((label) => ({ label, type: "type", detail: "column type" })),
    ...symbols.enums.map((e) => ({
      label: e.name,
      type: "enum",
      detail: `enum · ${e.values.length} values`,
      info: e.values.map((v) => v.name).join(", "),
      boost: 50,
    })),
  ];
}

/** Context-aware DBML completion: knows the tables, fields, enums and blocks of the current document. */
export function dbmlCompletion(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[\w."`]+/);
  if (!word && !context.explicit) return null;
  const from = word ? word.from : context.pos;

  const state = context.state;
  const symbols = getSymbols(state);
  const line = state.doc.lineAt(context.pos);
  const prefix = line.text.slice(0, context.pos - line.from);
  const inSettings = /\[[^\]]*$/.test(prefix);
  const currentTable = tableAt(symbols, state.doc, context.pos);

  // `Table.` anywhere (relationship endpoints, inline refs, indexes) -> that table's own columns
  const dotted = /([\w"]+)\.\s*([\w"]*)$/.exec(prefix);
  if (dotted) {
    const owner = symbols.tableByName.get(dotted[1].replace(/"/g, "").toLowerCase());
    if (owner) {
      return {
        from: context.pos - dotted[2].length,
        options: owner.fields.map((f) => ({
          label: f.name,
          type: f.pk ? "constant" : "property",
          detail: f.type + (f.pk ? " · pk" : ""),
          info: f.note,
        })),
        validFor: /^\w*$/,
      };
    }
  }

  // `[delete: …]` / `[update: …]`
  if (inSettings && /(delete|update)\s*:\s*[\w ]*$/i.test(prefix)) {
    return { from, options: REF_SETTINGS, validFor: /^[\w ]*$/ };
  }

  // `[ref: > Table.column]` — inside a settings block, after the relation token
  if (inSettings && /ref\s*:\s*(<>|[<>-])\s*[\w."]*$/i.test(prefix)) {
    return { from, options: [...tableCompletions(symbols), ...qualifiedFieldCompletions(symbols)] };
  }

  if (inSettings) {
    const isTableHeader = /^\s*Table\b/i.test(line.text);
    return {
      from,
      options: isTableHeader ? TABLE_SETTINGS : COLUMN_SETTINGS,
      validFor: /^[\w ]*$/,
    };
  }

  // `Ref: a.b > c.d` — both endpoints
  if (/^\s*Ref\b/i.test(line.text) || /(<>|[<>-])\s*[\w."]*$/.test(prefix)) {
    return { from, options: [...tableCompletions(symbols), ...qualifiedFieldCompletions(symbols)] };
  }

  // inside a TableGroup block -> table names only
  const group = symbols.groups.find(
    (g) => line.number > g.line && line.number <= g.endLine,
  );
  if (group) return { from, options: tableCompletions(symbols), validFor: /^\w*$/ };

  // inside a table block: first token = field name, second = type
  if (currentTable && line.number > currentTable.line) {
    const beforeWord = prefix.slice(0, from - line.from);
    if (/^\s*$/.test(beforeWord)) {
      return {
        from,
        options: [
          snippetCompletion("id integer [pk, increment]", { label: "id", type: "property", detail: "pk column", boost: 60 }),
          snippetCompletion("created_at timestamp [default: `now()`]", {
            label: "created_at",
            type: "property",
            detail: "timestamp column",
          }),
          snippetCompletion("updated_at timestamp [default: `now()`]", {
            label: "updated_at",
            type: "property",
            detail: "timestamp column",
          }),
          snippetCompletion("Note: '${text}'", { label: "Note", type: "keyword", detail: "table note" }),
          snippetCompletion("indexes {\n  (${col1}, ${col2})\n}", { label: "indexes", type: "keyword", detail: "index block" }),
        ],
        validFor: /^\w*$/,
      };
    }
    return { from, options: typeCompletions(symbols), validFor: /^\w*$/ };
  }

  return {
    from,
    options: [...TOP_LEVEL, ...tableCompletions(symbols), ...typeCompletions(symbols)],
    validFor: /^\w*$/,
  };
}
