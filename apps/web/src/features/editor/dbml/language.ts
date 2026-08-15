import { HighlightStyle, StreamLanguage, foldService, indentService, syntaxHighlighting } from "@codemirror/language";
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

/**
 * `var(--color-syntax-*)` rather than literal hex: CodeMirror's `HighlightStyle`
 * just feeds these strings into generated CSS rules, so a CSS custom property
 * works exactly like a literal colour would — and the browser re-evaluates it
 * live when `tokens.css`'s `[data-theme="light"]` block takes over, with no
 * CodeMirror reconfiguration needed. See that file for the light-mode values
 * (deepened, not inverted — several of these read fine on near-black but fail
 * contrast on white at the same lightness).
 */
export const dbmlHighlightStyle = HighlightStyle.define([
  { tag: t.comment, color: "var(--color-syntax-comment)", fontStyle: "italic" },
  { tag: t.keyword, color: "var(--color-syntax-keyword)", fontWeight: "600" },
  { tag: t.modifier, color: "var(--color-syntax-modifier)" },
  { tag: t.typeName, color: "var(--color-syntax-type)" },
  { tag: t.className, color: "var(--color-syntax-class)" },
  { tag: t.variableName, color: "var(--color-syntax-variable)" },
  { tag: t.string, color: "var(--color-syntax-string)" },
  { tag: t.special(t.string), color: "var(--color-syntax-string)" },
  { tag: t.number, color: "var(--color-syntax-number)" },
  { tag: t.color, color: "var(--color-syntax-number)" },
  { tag: t.operator, color: "var(--color-syntax-operator)", fontWeight: "600" },
  { tag: t.punctuation, color: "var(--color-syntax-punctuation)" },
  { tag: t.brace, color: "var(--color-syntax-brace)" },
  { tag: t.squareBracket, color: "var(--color-syntax-punctuation)" },
  { tag: t.paren, color: "var(--color-syntax-punctuation)" },
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

/**
 * Structural editor chrome (background, gutters, tooltips, panels) — also
 * `var(--color-editor-*)`-based for the same live-re-evaluation reason as
 * `dbmlHighlightStyle` above. `{ dark: true }` is CodeMirror's own flag for a
 * couple of internal default behaviours (e.g. how it picks a default
 * selection tint before this theme's own override applies) and isn't
 * reactive to a later attribute change — a very minor, accepted gap versus
 * building a `Compartment`-based live reconfiguration for a flag whose
 * visible effect this theme already overrides everywhere it matters.
 */
export const athanorEditorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      fontFamily: "'Fira Code', 'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
      backgroundColor: "var(--color-editor-bg)",
      color: "var(--color-syntax-variable)",
    },
    ".cm-scroller": { lineHeight: "1.6" },
    ".cm-content": {
      caretColor: "var(--color-primary)",
      paddingTop: "8px",
      paddingBottom: "40vh",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--color-primary)",
      borderLeftWidth: "2px",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "var(--color-editor-selection) !important",
    },
    ".cm-selectionMatch": { backgroundColor: "var(--color-primary-light)" },
    ".cm-searchMatch": { backgroundColor: "rgba(234, 179, 8, 0.25)", outline: "1px solid rgba(234,179,8,0.45)" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "rgba(234, 179, 8, 0.5)" },
    ".cm-gutters": {
      backgroundColor: "var(--color-editor-gutter-bg)",
      color: "var(--color-editor-gutter-text)",
      borderRight: "1px solid var(--color-editor-border)",
    },
    ".cm-foldGutter span": { color: "var(--color-editor-muted)", cursor: "pointer" },
    ".cm-activeLine": { backgroundColor: "var(--color-editor-active-line)" },
    ".cm-activeLineGutter": {
      backgroundColor: "var(--color-editor-active-line)",
      color: "var(--color-editor-active-gutter-text)",
    },
    ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
      backgroundColor: "var(--color-primary-light)",
      outline: "1px solid var(--color-primary-hover)",
      color: "inherit",
    },
    ".cm-nonmatchingBracket": { backgroundColor: "var(--color-danger-light)" },
    ".cm-tooltip": {
      backgroundColor: "var(--color-editor-tooltip-bg)",
      border: "1px solid var(--color-editor-tooltip-border)",
      borderRadius: "6px",
      boxShadow: "var(--shadow-lg)",
      color: "var(--color-syntax-variable)",
    },
    ".cm-tooltip-autocomplete > ul > li": { padding: "4px 8px", color: "var(--color-syntax-variable)" },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--color-primary)",
      color: "var(--color-text-on-accent)",
    },
    ".cm-completionIcon": { opacity: 0.7, paddingRight: "12px" },
    ".cm-completionDetail": {
      color: "var(--color-editor-muted)",
      fontStyle: "normal",
      marginLeft: "1em",
      fontSize: "0.9em",
    },
    ".cm-tooltip.cm-tooltip-hover": { padding: "8px 10px", maxWidth: "380px", fontSize: "12px" },
    ".cm-panels": {
      backgroundColor: "var(--color-editor-tooltip-bg)",
      color: "var(--color-syntax-variable)",
      borderColor: "var(--color-editor-border)",
    },
    ".cm-panel.cm-search input, .cm-panel.cm-gotoLine input": {
      backgroundColor: "var(--color-editor-bg)",
      color: "var(--color-syntax-variable)",
      border: "1px solid var(--color-editor-tooltip-border)",
      borderRadius: "4px",
      padding: "2px 6px",
    },
    ".cm-panel.cm-search button, .cm-panel.cm-gotoLine button": {
      backgroundColor: "var(--color-editor-border)",
      backgroundImage: "none",
      color: "var(--color-syntax-variable)",
      border: "1px solid var(--color-editor-tooltip-border)",
      borderRadius: "4px",
      padding: "2px 8px",
      cursor: "pointer",
    },
    ".cm-panel.cm-search label": { color: "var(--color-editor-muted)", fontSize: "11px" },
    ".cm-dbml-error-mark": {
      textDecoration: "underline wavy var(--color-danger)",
      textDecorationSkipInk: "none",
      backgroundColor: "var(--color-danger-light)",
      borderRadius: "2px",
    },
    ".cm-dbml-link": {
      textDecoration: "underline",
      textDecorationColor: "var(--color-primary-hover)",
      cursor: "pointer",
    },
    ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy var(--color-danger)" },
    ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy #EAB308" },
    ".cm-dbml-hover": { display: "flex", flexDirection: "column", gap: "4px", minWidth: "180px" },
    ".cm-dbml-hover-title": { fontWeight: "600", color: "var(--color-syntax-variable)" },
    ".cm-dbml-hover-kind": {
      color: "var(--color-primary-hover)",
      textTransform: "uppercase",
      fontSize: "10px",
      letterSpacing: "0.04em",
      marginRight: "2px",
    },
    ".cm-dbml-hover-muted": { color: "var(--color-editor-muted)", fontSize: "11px" },
    ".cm-dbml-hover-note": { color: "var(--color-syntax-string)", fontStyle: "italic", fontSize: "11.5px" },
    ".cm-dbml-hover-fields": {
      display: "flex",
      flexDirection: "column",
      gap: "1px",
      maxHeight: "260px",
      overflowY: "auto",
    },
    ".cm-dbml-hover-row": { display: "flex", gap: "8px", alignItems: "baseline" },
    ".cm-dbml-hover-row.is-current": {
      backgroundColor: "var(--color-primary-light)",
      borderRadius: "3px",
      padding: "0 3px",
    },
    ".cm-dbml-hover-name": { color: "var(--color-syntax-variable)", minWidth: "90px" },
    ".cm-dbml-hover-type": { color: "var(--color-syntax-type)" },
    ".cm-dbml-hover-flag": { color: "var(--color-syntax-modifier)", fontSize: "10.5px" },
    ".cm-foldPlaceholder": {
      backgroundColor: "var(--color-editor-border)",
      border: "1px solid var(--color-editor-tooltip-border)",
      color: "var(--color-editor-muted)",
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
