import {
  HighlightStyle,
  StreamLanguage,
  foldService,
  indentService,
  syntaxHighlighting,
} from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";

export const DBML_TYPES = [
  "integer",
  "int",
  "int2",
  "int4",
  "int8",
  "bigint",
  "smallint",
  "tinyint",
  "mediumint",
  "serial",
  "bigserial",
  "smallserial",
  "varchar",
  "nvarchar",
  "char",
  "nchar",
  "character",
  "character varying",
  "text",
  "longtext",
  "mediumtext",
  "tinytext",
  "boolean",
  "bool",
  "bit",
  "timestamp",
  "timestamptz",
  "datetime",
  "datetime2",
  "date",
  "time",
  "timetz",
  "interval",
  "year",
  "decimal",
  "numeric",
  "money",
  "float",
  "float4",
  "float8",
  "double",
  "double precision",
  "real",
  "uuid",
  "json",
  "jsonb",
  "xml",
  "blob",
  "bytea",
  "binary",
  "varbinary",
  "enum",
  "inet",
  "cidr",
  "macaddr",
  "point",
  "geometry",
  "geography",
  "array",
];

export const DBML_KEYWORDS = ["Table", "Ref", "Enum", "Note", "Project", "TableGroup", "indexes", "as"];

const DBML_SETTINGS = [
  "pk",
  "primary key",
  "unique",
  "not null",
  "null",
  "increment",
  "default",
  "note",
  "name",
  "ref",
  "type",
  "headercolor",
  "delete",
  "update",
  "database_type",
];

const KEYWORDS = new Set(DBML_KEYWORDS.map((k) => k.toLowerCase()));
const SETTINGS = new Set(DBML_SETTINGS.map((k) => k.toLowerCase()));
const TYPES = new Set(DBML_TYPES);

/**
 * Stream lexer for DBML. Token names are mapped to concrete highlight tags via
 * `tokenTable` so the colours below apply regardless of the base theme.
 */
export const dbmlLanguage = StreamLanguage.define<{ inCommentBlock: boolean; inNoteBlock: boolean }>({
  name: "dbml",
  startState() {
    return { inCommentBlock: false, inNoteBlock: false };
  },
  token(stream, state) {
    if (state.inCommentBlock) {
      if (stream.match("*/")) state.inCommentBlock = false;
      else stream.next();
      return "comment";
    }
    if (state.inNoteBlock) {
      if (stream.match("'''")) state.inNoteBlock = false;
      else stream.next();
      return "string";
    }
    if (stream.eatSpace()) return null;

    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/*")) {
      state.inCommentBlock = true;
      return "comment";
    }
    if (stream.match("'''")) {
      state.inNoteBlock = true;
      return "string";
    }
    if (stream.match("`")) {
      while (!stream.eol()) if (stream.next() === "`") break;
      return "expression";
    }
    const quote = stream.peek();
    if (quote === '"' || quote === "'") {
      stream.next();
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === quote && stream.string.charAt(stream.pos - 2) !== "\\") break;
      }
      return quote === '"' ? "quotedName" : "string";
    }
    if (stream.match(/^#[0-9a-fA-F]{3,8}\b/)) return "color";
    if (stream.match(/^[{}]/)) return "brace";
    if (stream.match(/^[[\]]/)) return "squareBracket";
    if (stream.match(/^[()]/)) return "paren";
    if (stream.match(/^(<>|[<>-])/)) return "relation";
    if (stream.match(/^[:,]/)) return "punctuation";
    if (stream.match(/^\d+(\.\d+)?/)) return "number";

    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) {
      const word = stream.current();
      const lower = word.toLowerCase();
      if (KEYWORDS.has(lower)) return "keyword";
      if (SETTINGS.has(lower)) return "setting";
      if (TYPES.has(lower)) return "typeName";
      // `X.` -> table qualifier, otherwise a plain identifier
      if (stream.peek() === ".") return "className";
      return "variableName";
    }

    stream.next();
    return null;
  },
  tokenTable: {
    comment: t.comment,
    string: t.string,
    quotedName: t.special(t.string),
    expression: t.special(t.string),
    keyword: t.keyword,
    setting: t.modifier,
    typeName: t.typeName,
    className: t.className,
    variableName: t.variableName,
    number: t.number,
    color: t.color,
    brace: t.brace,
    squareBracket: t.squareBracket,
    paren: t.paren,
    relation: t.operator,
    punctuation: t.punctuation,
  },
  languageData: {
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
    closeBrackets: { brackets: ["(", "[", "{", "'", '"', "`"] },
    indentOnInput: /^\s*\}$/,
  },
});

export const dbmlHighlightStyle = HighlightStyle.define([
  { tag: t.comment, color: "#5C6370", fontStyle: "italic" },
  { tag: t.keyword, color: "#C678DD", fontWeight: "600" },
  { tag: t.modifier, color: "#E5C07B" },
  { tag: t.typeName, color: "#56B6C2" },
  { tag: t.className, color: "#61AFEF" },
  { tag: t.variableName, color: "#E2E8F0" },
  { tag: t.string, color: "#98C379" },
  { tag: t.special(t.string), color: "#98C379" },
  { tag: t.number, color: "#D19A66" },
  { tag: t.color, color: "#D19A66" },
  { tag: t.operator, color: "#F472B6", fontWeight: "600" },
  { tag: t.punctuation, color: "#7F848E" },
  { tag: t.brace, color: "#ABB2BF" },
  { tag: t.squareBracket, color: "#7F848E" },
  { tag: t.paren, color: "#7F848E" },
]);

const INDENT_UNIT = 2;

/** Brace-depth indentation — StreamLanguage has no syntax tree to derive it from. */
const dbmlIndent = indentService.of((cx, pos) => {
  const line = cx.state.doc.lineAt(pos);
  let depth = 0;
  for (let n = 1; n < line.number; n++) {
    const text = cx.state.doc.line(n).text.replace(/\/\/.*$/, "");
    for (const ch of text) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth = Math.max(0, depth - 1);
    }
  }
  if (/^\s*\}/.test(line.text)) depth = Math.max(0, depth - 1);
  return depth * INDENT_UNIT;
});

/** Folds every `{ ... }` block (tables, enums, groups, indexes, notes). */
const dbmlFold = foldService.of((state, lineStart, lineEnd) => {
  const line = state.doc.lineAt(lineStart);
  const openIdx = line.text.replace(/\/\/.*$/, "").lastIndexOf("{");
  if (openIdx < 0) return null;
  let depth = 0;
  for (let n = line.number; n <= state.doc.lines; n++) {
    const text = state.doc.line(n).text.replace(/\/\/.*$/, "");
    for (let i = n === line.number ? openIdx : 0; i < text.length; i++) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          const closePos = state.doc.line(n).from + i;
          return closePos > lineEnd ? { from: lineEnd, to: closePos } : null;
        }
      }
    }
  }
  return null;
});

export const athanorEditorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      fontSize: "var(--dbml-font-size, 13px)",
      fontFamily: "'Fira Code', 'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
      backgroundColor: "#17181B",
      color: "#E2E8F0",
    },
    ".cm-scroller": { lineHeight: "1.6" },
    ".cm-content": {
      caretColor: "#6366F1",
      paddingTop: "8px",
      paddingBottom: "40vh",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "#6366F1",
      borderLeftWidth: "2px",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "#334155 !important",
    },
    ".cm-selectionMatch": { backgroundColor: "rgba(99, 102, 241, 0.22)" },
    ".cm-searchMatch": { backgroundColor: "rgba(234, 179, 8, 0.25)", outline: "1px solid rgba(234,179,8,0.45)" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "rgba(234, 179, 8, 0.5)" },
    ".cm-gutters": {
      backgroundColor: "#17181B",
      color: "#475569",
      borderRight: "1px solid #27272A",
    },
    ".cm-foldGutter span": { color: "#64748B", cursor: "pointer" },
    ".cm-activeLine": { backgroundColor: "#1E2024" },
    ".cm-activeLineGutter": { backgroundColor: "#1E2024", color: "#94A3B8" },
    ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
      backgroundColor: "rgba(99,102,241,0.28)",
      outline: "1px solid rgba(129,140,248,0.6)",
      color: "inherit",
    },
    ".cm-nonmatchingBracket": { backgroundColor: "rgba(239,68,68,0.3)" },
    ".cm-tooltip": {
      backgroundColor: "#1E2024",
      border: "1px solid #3F3F46",
      borderRadius: "6px",
      boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.5)",
      color: "#E2E8F0",
    },
    ".cm-tooltip-autocomplete > ul > li": { padding: "4px 8px", color: "#E2E8F0" },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "#6366F1", color: "#FFFFFF" },
    ".cm-completionIcon": { opacity: 0.7, paddingRight: "12px" },
    ".cm-completionDetail": { color: "#94A3B8", fontStyle: "normal", marginLeft: "1em", fontSize: "0.9em" },
    ".cm-tooltip.cm-tooltip-hover": { padding: "8px 10px", maxWidth: "380px", fontSize: "12px" },
    ".cm-panels": { backgroundColor: "#1E2024", color: "#E2E8F0", borderColor: "#27272A" },
    ".cm-panel.cm-search input, .cm-panel.cm-gotoLine input": {
      backgroundColor: "#17181B",
      color: "#E2E8F0",
      border: "1px solid #3F3F46",
      borderRadius: "4px",
      padding: "2px 6px",
    },
    ".cm-panel.cm-search button, .cm-panel.cm-gotoLine button": {
      backgroundColor: "#27272A",
      backgroundImage: "none",
      color: "#E2E8F0",
      border: "1px solid #3F3F46",
      borderRadius: "4px",
      padding: "2px 8px",
      cursor: "pointer",
    },
    ".cm-panel.cm-search label": { color: "#94A3B8", fontSize: "11px" },
    ".cm-dbml-error-mark": {
      textDecoration: "underline wavy #EF4444",
      textDecorationSkipInk: "none",
      backgroundColor: "rgba(239, 68, 68, 0.18)",
      borderRadius: "2px",
    },
    ".cm-dbml-link": {
      textDecoration: "underline",
      textDecorationColor: "#818CF8",
      cursor: "pointer",
    },
    ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy #EF4444" },
    ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy #EAB308" },
    ".cm-dbml-hover": { display: "flex", flexDirection: "column", gap: "4px", minWidth: "180px" },
    ".cm-dbml-hover-title": { fontWeight: "600", color: "#E2E8F0" },
    ".cm-dbml-hover-kind": {
      color: "#818CF8",
      textTransform: "uppercase",
      fontSize: "10px",
      letterSpacing: "0.04em",
      marginRight: "2px",
    },
    ".cm-dbml-hover-muted": { color: "#94A3B8", fontSize: "11px" },
    ".cm-dbml-hover-note": { color: "#98C379", fontStyle: "italic", fontSize: "11.5px" },
    ".cm-dbml-hover-fields": { display: "flex", flexDirection: "column", gap: "1px", maxHeight: "260px", overflowY: "auto" },
    ".cm-dbml-hover-row": { display: "flex", gap: "8px", alignItems: "baseline" },
    ".cm-dbml-hover-row.is-current": { backgroundColor: "rgba(99,102,241,0.2)", borderRadius: "3px", padding: "0 3px" },
    ".cm-dbml-hover-name": { color: "#E2E8F0", minWidth: "90px" },
    ".cm-dbml-hover-type": { color: "#56B6C2" },
    ".cm-dbml-hover-flag": { color: "#E5C07B", fontSize: "10.5px" },
    ".cm-foldPlaceholder": {
      backgroundColor: "#27272A",
      border: "1px solid #3F3F46",
      color: "#94A3B8",
      borderRadius: "4px",
      padding: "0 6px",
    },
  },
  { dark: true },
);

export const dbmlLanguageSupport = [
  dbmlLanguage,
  Prec.high(syntaxHighlighting(dbmlHighlightStyle)),
  dbmlIndent,
  dbmlFold,
];
