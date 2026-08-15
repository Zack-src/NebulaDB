import { StateField, Text, type EditorState } from "@codemirror/state";

/** A document offset range. */
export interface Span {
  from: number;
  to: number;
}

export interface InlineRef {
  /** `>`, `<`, `-` or `<>` */
  relation: string;
  table: string;
  field: string;
  /** span of the whole `ref: > Table.field` setting */
  span: Span;
  tableSpan: Span;
  fieldSpan: Span;
}

export interface FieldSymbol {
  name: string;
  /** normalized type, e.g. `varchar(255)` */
  type: string;
  /** raw `[...]` settings text, without brackets */
  settings: string;
  note?: string;
  line: number;
  nameSpan: Span;
  typeSpan: Span;
  inlineRefs: InlineRef[];
  pk: boolean;
  notNull: boolean;
  unique: boolean;
  increment: boolean;
}

export interface TableSymbol {
  name: string;
  schema?: string;
  alias?: string;
  note?: string;
  headerColor?: string;
  line: number;
  endLine: number;
  nameSpan: Span;
  fields: FieldSymbol[];
  indexes: string[];
}

export interface EnumSymbol {
  name: string;
  line: number;
  endLine: number;
  nameSpan: Span;
  values: Array<{ name: string; line: number }>;
}

export interface RefEndpoint {
  table: string;
  fields: string[];
  tableSpan: Span;
  fieldSpan: Span;
}

export interface RefSymbol {
  name?: string;
  line: number;
  relation: string;
  left: RefEndpoint;
  right: RefEndpoint;
}

export interface GroupSymbol {
  name: string;
  line: number;
  endLine: number;
  members: Array<{ name: string; line: number; span: Span }>;
}

export interface DbmlSymbols {
  tables: TableSymbol[];
  enums: EnumSymbol[];
  refs: RefSymbol[];
  groups: GroupSymbol[];
  projectName?: string;
  /** lowercased table name *and* alias -> table */
  tableByName: Map<string, TableSymbol>;
  enumByName: Map<string, EnumSymbol>;
  /** unbalanced-brace report, used by the linter */
  danglingOpen: number | null;
  strayClose: number[];
}

const IDENT = `(?:"[^"\\n]+"|\`[^\`\\n]+\`|[A-Za-z_][A-Za-z0-9_]*)`;

const RE_TABLE = new RegExp(`^\\s*(Table)\\s+(${IDENT})(?:\\s*\\.\\s*(${IDENT}))?(?:\\s+as\\s+(${IDENT}))?`, "i");
const RE_ENUM = new RegExp(`^\\s*(Enum)\\s+(${IDENT})(?:\\s*\\.\\s*(${IDENT}))?`, "i");
const RE_GROUP = new RegExp(`^\\s*(TableGroup)\\s+(${IDENT})`, "i");
const RE_PROJECT = new RegExp(`^\\s*(Project)\\s+(${IDENT})`, "i");
const RE_REF_HEAD = new RegExp(`^\\s*(Ref)\\b\\s*(${IDENT})?\\s*[:{]?`, "i");
const RE_FIELD = new RegExp(
  `^\\s*(${IDENT})\\s+(${IDENT}(?:\\s*\\([^)]*\\))?(?:\\s*\\[\\s*\\])?)\\s*(\\[[^\\]]*\\])?\\s*$`,
);
const RE_ENDPOINT = `(?:(${IDENT})\\s*\\.\\s*)?(${IDENT})\\s*\\.\\s*(?:\\(([^)]*)\\)|(${IDENT}))`;
const RE_REF_BODY = new RegExp(`${RE_ENDPOINT}\\s*(<>|[<>-])\\s*${RE_ENDPOINT}`);
const RE_INLINE_REF = new RegExp(
  `\\bref\\s*:\\s*(<>|[<>-])\\s*(?:${IDENT}\\s*\\.\\s*)?(${IDENT})\\s*\\.\\s*(${IDENT})`,
  "gi",
);

export function unquoteIdent(raw: string): string {
  return raw.replace(/^["'`]/, "").replace(/["'`]$/, "");
}

interface MaskState {
  blockComment: boolean;
  tripleQuote: boolean;
}

/**
 * Blanks out comments (and multi-line `'''` note bodies) while preserving the
 * line's length, so every offset computed on the masked text still maps 1:1
 * onto the real document. Quoted identifiers/strings are kept as-is because
 * DBML allows `"quoted names"` that we still need to read.
 */
function maskLine(text: string, st: MaskState): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (st.tripleQuote) {
      if (text.startsWith("'''", i)) {
        st.tripleQuote = false;
        out += "   ";
        i += 3;
      } else {
        out += " ";
        i += 1;
      }
      continue;
    }
    if (st.blockComment) {
      if (text.startsWith("*/", i)) {
        st.blockComment = false;
        out += "  ";
        i += 2;
      } else {
        out += " ";
        i += 1;
      }
      continue;
    }
    if (text.startsWith("'''", i)) {
      st.tripleQuote = true;
      out += "   ";
      i += 3;
      continue;
    }
    if (text.startsWith("//", i)) {
      out += " ".repeat(text.length - i);
      break;
    }
    if (text.startsWith("/*", i)) {
      st.blockComment = true;
      out += "  ";
      i += 2;
      continue;
    }
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      out += ch;
      i += 1;
      while (i < text.length) {
        const cur = text[i];
        out += cur;
        i += 1;
        if (cur === ch && text[i - 2] !== "\\") break;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function spanOf(lineFrom: number, masked: string, token: string, searchFrom: number): Span {
  const idx = masked.indexOf(token, searchFrom);
  if (idx < 0) return { from: lineFrom + searchFrom, to: lineFrom + searchFrom + token.length };
  return { from: lineFrom + idx, to: lineFrom + idx + token.length };
}

function countBraces(masked: string): number {
  let depth = 0;
  for (const ch of masked) {
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
  }
  return depth;
}

function parseSettings(raw: string | undefined) {
  const settings = raw ? raw.slice(1, -1) : "";
  const noteMatch = /note\s*:\s*(?:'''([\s\S]*?)'''|'([^']*)'|"([^"]*)")/i.exec(settings);
  return {
    settings,
    note: noteMatch ? (noteMatch[1] ?? noteMatch[2] ?? noteMatch[3]) : undefined,
    pk: /\b(pk|primary key)\b/i.test(settings),
    notNull: /\bnot\s+null\b/i.test(settings),
    unique: /\bunique\b/i.test(settings),
    increment: /\bincrement\b/i.test(settings),
  };
}

function parseEndpoint(
  lineFrom: number,
  masked: string,
  schemaRaw: string | undefined,
  tableRaw: string,
  groupRaw: string | undefined,
  singleRaw: string | undefined,
  searchFrom: number,
): { endpoint: RefEndpoint; next: number } {
  const tableSpan = spanOf(lineFrom, masked, tableRaw, searchFrom);
  const fieldsRaw = groupRaw ?? singleRaw ?? "";
  const fields = fieldsRaw
    .split(",")
    .map((f) => unquoteIdent(f.trim()))
    .filter(Boolean);
  const fieldSpan = singleRaw
    ? spanOf(lineFrom, masked, singleRaw, tableSpan.to - lineFrom)
    : { from: tableSpan.to, to: tableSpan.to };
  return {
    endpoint: {
      table: unquoteIdent(tableRaw),
      fields,
      tableSpan,
      fieldSpan,
    },
    next: Math.max(fieldSpan.to, tableSpan.to) - lineFrom,
  };
}

/** Parses the whole document into a symbol table used by completion, go-to-definition, hover, lint, outline and rename. */
// eslint-disable-next-line complexity -- a single-pass line-based DBML state machine (table/enum/group/ref/note contexts); the branching is the grammar, not incidental structure
export function parseDbmlSymbols(doc: Text): DbmlSymbols {
  const tables: TableSymbol[] = [];
  const enums: EnumSymbol[] = [];
  const refs: RefSymbol[] = [];
  const groups: GroupSymbol[] = [];
  let projectName: string | undefined;
  const strayClose: number[] = [];

  const mask: MaskState = { blockComment: false, tripleQuote: false };
  type Ctx = "table" | "enum" | "group" | "project" | "ref" | "note" | null;
  let ctx: Ctx = null;
  let depth = 0;
  let inIndexes = false;
  let table: TableSymbol | null = null;
  let enumSym: EnumSymbol | null = null;
  let group: GroupSymbol | null = null;
  let openLine: number | null = null;

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const masked = maskLine(line.text, mask);
    const trimmed = masked.trim();
    const delta = countBraces(masked);

    if (ctx === null) {
      if (!trimmed) {
        continue;
      }
      let m: RegExpExecArray | null;
      if ((m = RE_TABLE.exec(masked))) {
        const hasSchema = Boolean(m[3]);
        const nameRaw = hasSchema ? m[3]! : m[2];
        const nameSpan = spanOf(line.from, masked, nameRaw, (m.index ?? 0) + m[1].length);
        table = {
          name: unquoteIdent(nameRaw),
          schema: hasSchema ? unquoteIdent(m[2]) : undefined,
          alias: m[4] ? unquoteIdent(m[4]) : undefined,
          line: n,
          endLine: n,
          nameSpan,
          fields: [],
          indexes: [],
        };
        const colorMatch = /headercolor\s*:\s*'?(#[0-9a-f]{3,8})'?/i.exec(masked);
        if (colorMatch) table.headerColor = colorMatch[1];
        tables.push(table);
        ctx = "table";
      } else if ((m = RE_ENUM.exec(masked))) {
        const nameRaw = m[3] ?? m[2];
        enumSym = {
          name: unquoteIdent(nameRaw),
          line: n,
          endLine: n,
          nameSpan: spanOf(line.from, masked, nameRaw, (m.index ?? 0) + m[1].length),
          values: [],
        };
        enums.push(enumSym);
        ctx = "enum";
      } else if ((m = RE_GROUP.exec(masked))) {
        group = {
          name: unquoteIdent(m[2]),
          line: n,
          endLine: n,
          members: [],
        };
        groups.push(group);
        ctx = "group";
      } else if ((m = RE_PROJECT.exec(masked))) {
        projectName = unquoteIdent(m[2]);
        ctx = "project";
      } else if (RE_REF_HEAD.test(masked)) {
        const body = RE_REF_BODY.exec(masked);
        if (body) {
          const left = parseEndpoint(line.from, masked, body[1], body[2], body[3], body[4], 0);
          const rel = body[5];
          const right = parseEndpoint(line.from, masked, body[6], body[7], body[8], body[9], left.next);
          refs.push({ line: n, relation: rel, left: left.endpoint, right: right.endpoint });
        }
        ctx = "ref";
      } else if (/^\s*Note\b/i.test(masked)) {
        ctx = "note";
      }

      if (ctx !== null) {
        depth = delta;
        openLine = depth > 0 ? n : null;
        if (depth <= 0) {
          // single-line block (e.g. `Ref: a.b > c.d`)
          if (table) table.endLine = n;
          if (enumSym) enumSym.endLine = n;
          if (group) group.endLine = n;
          ctx = null;
          table = null;
          enumSym = null;
          group = null;
          depth = 0;
        }
      } else if (trimmed.startsWith("}")) {
        strayClose.push(n);
      }
      continue;
    }

    // ---- inside a block ----
    const closing = depth + delta <= 0;

    if (ctx === "table" && table) {
      if (/^\s*indexes\s*\{/i.test(masked)) inIndexes = true;
      else if (inIndexes && /^\s*\}/.test(masked)) inIndexes = false;
      else if (inIndexes && trimmed) table.indexes.push(trimmed);
      else if (/^\s*Note\s*:/i.test(masked)) {
        const noteMatch = /Note\s*:\s*(?:'''([\s\S]*?)'''|'([^']*)'|"([^"]*)")/i.exec(masked);
        if (noteMatch) table.note = noteMatch[1] ?? noteMatch[2] ?? noteMatch[3];
      } else if (trimmed && !trimmed.startsWith("}")) {
        const fm = RE_FIELD.exec(masked);
        if (fm) {
          const nameSpan = spanOf(line.from, masked, fm[1], 0);
          const typeRaw = fm[2].replace(/\s+/g, "");
          const typeSpan = spanOf(line.from, masked, fm[2], nameSpan.to - line.from);
          const parsed = parseSettings(fm[3]);
          const inlineRefs: InlineRef[] = [];
          RE_INLINE_REF.lastIndex = 0;
          let im: RegExpExecArray | null;
          while ((im = RE_INLINE_REF.exec(masked))) {
            const tableOffset = im[0].lastIndexOf(im[2], im[0].lastIndexOf(im[3]));
            const fieldOffset = im[0].indexOf(im[3], tableOffset + im[2].length);
            inlineRefs.push({
              relation: im[1],
              table: unquoteIdent(im[2]),
              field: unquoteIdent(im[3]),
              span: { from: line.from + im.index, to: line.from + im.index + im[0].length },
              tableSpan: {
                from: line.from + im.index + tableOffset,
                to: line.from + im.index + tableOffset + im[2].length,
              },
              fieldSpan: {
                from: line.from + im.index + fieldOffset,
                to: line.from + im.index + fieldOffset + im[3].length,
              },
            });
          }
          table.fields.push({
            name: unquoteIdent(fm[1]),
            type: typeRaw,
            typeSpan,
            nameSpan,
            line: n,
            inlineRefs,
            ...parsed,
          });
        }
      }
    } else if (ctx === "enum" && enumSym) {
      if (trimmed && !trimmed.startsWith("}")) {
        const vm = new RegExp(`^\\s*(${IDENT})`).exec(masked);
        if (vm) enumSym.values.push({ name: unquoteIdent(vm[1]), line: n });
      }
    } else if (ctx === "group" && group) {
      if (trimmed && !trimmed.startsWith("}")) {
        const gm = new RegExp(`^\\s*(${IDENT})`).exec(masked);
        if (gm) {
          group.members.push({
            name: unquoteIdent(gm[1]),
            line: n,
            span: spanOf(line.from, masked, gm[1], 0),
          });
        }
      }
    } else if (ctx === "ref") {
      const body = RE_REF_BODY.exec(masked);
      if (body) {
        const left = parseEndpoint(line.from, masked, body[1], body[2], body[3], body[4], 0);
        const right = parseEndpoint(line.from, masked, body[6], body[7], body[8], body[9], left.next);
        refs.push({ line: n, relation: body[5], left: left.endpoint, right: right.endpoint });
      }
    }

    depth += delta;
    if (closing) {
      if (table) table.endLine = n;
      if (enumSym) enumSym.endLine = n;
      if (group) group.endLine = n;
      ctx = null;
      table = null;
      enumSym = null;
      group = null;
      inIndexes = false;
      depth = 0;
      openLine = null;
    }
  }

  // a block still open at EOF (the user is mid-typing) runs to the last line,
  // so `tableAt`/`groups` still resolve while the closing brace is missing
  if (ctx !== null) {
    if (table) table.endLine = doc.lines;
    if (enumSym) enumSym.endLine = doc.lines;
    if (group) group.endLine = doc.lines;
  }

  const tableByName = new Map<string, TableSymbol>();
  for (const t of tables) {
    tableByName.set(t.name.toLowerCase(), t);
    if (t.alias) tableByName.set(t.alias.toLowerCase(), t);
  }
  const enumByName = new Map<string, EnumSymbol>();
  for (const e of enums) enumByName.set(e.name.toLowerCase(), e);

  return {
    tables,
    enums,
    refs,
    groups,
    projectName,
    tableByName,
    enumByName,
    danglingOpen: ctx !== null ? openLine : null,
    strayClose,
  };
}

/** Cached parse of the current document — recomputed only when the doc changes. */
export const dbmlSymbolsField = StateField.define<DbmlSymbols>({
  create: (state) => parseDbmlSymbols(state.doc),
  update: (value, tr) => (tr.docChanged ? parseDbmlSymbols(tr.state.doc) : value),
});

export function getSymbols(state: EditorState): DbmlSymbols {
  return state.field(dbmlSymbolsField, false) ?? parseDbmlSymbols(state.doc);
}

export function findTable(symbols: DbmlSymbols, name: string): TableSymbol | undefined {
  return symbols.tableByName.get(unquoteIdent(name).toLowerCase());
}

export function findField(table: TableSymbol, name: string): FieldSymbol | undefined {
  const needle = unquoteIdent(name).toLowerCase();
  return table.fields.find((f) => f.name.toLowerCase() === needle);
}

/**
 * A canonical fingerprint of what a DBML document *declares*, ignoring layout,
 * comments, settings order and block order.
 *
 * The panel compares the buffer against the engine's re-serialization of the
 * project (`projectToDbml`) on every project update. Comparing the raw strings
 * meant any locally formatted/commented buffer was replaced by the canonical
 * output moments after each sync; comparing signatures keeps the user's text
 * whenever nothing actually changed in the schema.
 *
 * Only what `projectToDbml` can actually emit is compared — tables, columns,
 * enums and relationships. Aliases, `headercolor`, `TableGroup` and `Project`
 * blocks are excluded: the serializer drops them, so comparing them would
 * report a change on every single sync for documents that use them.
 */
export function dbmlSignature(source: string | Text): string {
  const doc = typeof source === "string" ? Text.of(source.split("\n")) : source;
  const symbols = parseDbmlSymbols(doc);

  const fieldSig = (f: FieldSymbol) =>
    [
      f.name.toLowerCase(),
      f.type.toLowerCase(),
      f.pk ? "pk" : "",
      f.unique ? "uq" : "",
      f.notNull ? "nn" : "",
      f.increment ? "inc" : "",
      f.note ?? "",
      f.inlineRefs.map((r) => `${r.relation}${r.table.toLowerCase()}.${r.field.toLowerCase()}`).join("+"),
      // `\`now()\`` and `'now()'` are the same default as far as the serializer
      // is concerned — it rewrites backtick expressions as strings on export
      unquoteIdent(/\bdefault\s*:\s*([^,\]]+)/i.exec(f.settings)?.[1].trim() ?? ""),
    ].join(":");

  // `(a, b) [unique, name: 'x']` -> `a,b|name:'x';unique`, so settings order and
  // spacing don't register as a schema change
  const indexSig = (line: string) => {
    const cols = (/\(([^)]*)\)/.exec(line)?.[1] ?? /^\s*("?[\w.]+"?)/.exec(line)?.[1] ?? "")
      .split(",")
      .map((c) => unquoteIdent(c.trim()).toLowerCase())
      .filter(Boolean)
      .join(",");
    const settings = (/\[([^\]]*)\]/.exec(line)?.[1] ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .sort()
      .join(";");
    return `${cols}|${settings}`;
  };

  const tables = symbols.tables
    .map((t) =>
      [
        `${(t.schema ?? "").toLowerCase()}.${t.name.toLowerCase()}`,
        t.note ?? "",
        t.fields.map(fieldSig).join(";"),
        t.indexes.map(indexSig).sort().join(";"),
      ].join("|"),
    )
    .sort();

  const enums = symbols.enums
    .map((event) => `${event.name.toLowerCase()}|${event.values.map((v) => v.name.toLowerCase()).join(";")}`)
    .sort();

  const refs = symbols.refs
    .map((r) => {
      const side = (endpoint: { table: string; fields: string[] }) =>
        `${endpoint.table.toLowerCase()}.${endpoint.fields.map((f) => f.toLowerCase()).join(",")}`;
      return `${side(r.left)}${r.relation}${side(r.right)}`;
    })
    .sort();

  return JSON.stringify({ tables, enums, refs });
}

/** The table whose block contains document offset `pos`, if any (used for the breadcrumb). */
export function tableAt(symbols: DbmlSymbols, doc: Text, pos: number): TableSymbol | undefined {
  const lineNo = doc.lineAt(pos).number;
  return symbols.tables.find((t) => lineNo >= t.line && lineNo <= t.endLine);
}
