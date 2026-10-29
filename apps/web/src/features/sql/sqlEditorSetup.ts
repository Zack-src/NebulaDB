import { Compartment, Prec, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, redo, undo } from "@codemirror/commands";
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  startCompletion,
  type Completion,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { highlightSelectionMatches } from "@codemirror/search";
import {
  MSSQL,
  MySQL,
  PLSQL,
  PostgreSQL,
  SQLDialect,
  SQLite,
  StandardSQL,
  sql,
  type SQLNamespace,
} from "@codemirror/lang-sql";
import { tags as t } from "@lezer/highlight";
import type { DatabaseEngine } from "@nebuladb/shared";
import { dbmlHighlightStyle, nebulaEditorTheme } from "@/features/editor/dbml/language";

/**
 * `lang-sql` has no BigQuery dialect: standard SQL, with the backtick BigQuery
 * quotes its names in (see `quoteIdentifier`).
 */
const BigQuerySQL = SQLDialect.define({ ...StandardSQL.spec, identifierQuotes: "`" });

const DIALECTS: Record<DatabaseEngine, SQLDialect> = {
  postgres: PostgreSQL,
  mysql: MySQL,
  mssql: MSSQL,
  oracle: PLSQL,
  sqlite: SQLite,
  bigquery: BigQuerySQL,
};

export const sqlLanguageCompartment = new Compartment();
export const sqlCompletionCompartment = new Compartment();
export const sqlBracketsCompartment = new Compartment();

export interface SqlCompletionData {
  /** Tables, and their columns after `table.` — see `toSqlSchema`. */
  schema: SQLNamespace;
  defaultSchema?: string;
  /** The columns to offer where no table is spelled out — see `columnCompletions`. */
  columns: (statement: string) => Completion[];
}

/** Where a name is not being written: inside a string, a comment or a quoted name. */
const NOT_A_NAME = /String|Comment|QuotedIdentifier/;

function bareColumnSource(columns: SqlCompletionData["columns"]): CompletionSource {
  return (context) => {
    const word = context.matchBefore(/[\w$]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    // After a dot the name is qualified: `lang-sql` completes it from the schema.
    if (context.state.sliceDoc(word.from - 1, word.from) === ".") return null;
    if (NOT_A_NAME.test(syntaxTree(context.state).resolveInner(context.pos, -1).name)) return null;
    const options = columns(context.state.doc.toString());
    return options.length > 0 ? { from: word.from, options, validFor: /^[\w$]*$/ } : null;
  };
}

/** The engine's dialect, completing its keywords and what `completion` knows of the database. */
export function sqlLanguage(engine: DatabaseEngine, completion?: SqlCompletionData): Extension {
  const dialect = DIALECTS[engine] ?? StandardSQL;
  return [
    // Upper-case keywords: how the console writes its own statements (`previewRowsStatement`).
    sql({
      dialect,
      schema: completion?.schema,
      defaultSchema: completion?.defaultSchema,
      upperCaseKeywords: true,
    }),
    completion ? dialect.language.data.of({ autocomplete: bareColumnSource(completion.columns) }) : [],
  ];
}

/** Same list as the DBML editor's, fed by the language instead of one source. */
export function sqlCompletionExtension(activateOnTyping: boolean): Extension {
  return autocompletion({
    selectOnOpen: true,
    activateOnTyping,
    closeOnBlur: true,
    icons: true,
    maxRenderedOptions: 60,
  });
}

export function sqlBracketsExtension(enabled: boolean): Extension {
  return enabled ? closeBrackets() : [];
}

/** What SQL has and DBML does not, in the same `var(--color-syntax-*)` tokens as `dbmlHighlightStyle`. */
const sqlHighlightStyle = HighlightStyle.define([
  { tag: [t.bool, t.null], color: "var(--color-syntax-number)" },
  { tag: t.standard(t.name), color: "var(--color-syntax-class)" },
]);

/**
 * The DBML editor fills a pane; this one is a field of a form. It is as tall
 * as the textarea it replaces while there is little in it, grows with the
 * statement, and scrolls past a ceiling so the result grid below stays in
 * reach.
 */
function sqlFieldTheme(compact: boolean): Extension {
  const minHeight = compact ? "5rem" : "10rem";
  return EditorView.theme({
    "&": { height: "auto", maxHeight: compact ? "min(18rem, 40vh)" : "min(28rem, 50vh)", fontSize: "12.5px" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { overflow: "auto" },
    ".cm-content": { minHeight, paddingBottom: "8px" },
    ".cm-gutter": { minHeight },
    ".cm-gutters": { fontSize: "11.5px" },
    ".cm-placeholder": { color: "var(--color-text-muted)" },
  });
}

export interface SqlEditorOptions {
  engine: DatabaseEngine;
  /** A shorter field — see `SqlPanel`. */
  compact: boolean;
  autoComplete: boolean;
  closeBrackets: boolean;
  placeholder: string;
  /** Read on every update, so the label follows the interface language. */
  label: () => string;
  onChange: (value: string) => void;
  onRun: () => void;
}

export function createSqlExtensions(options: SqlEditorOptions): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    highlightSpecialChars(),
    drawSelection(),
    dropCursor(),
    history(),
    indentOnInput(),
    indentUnit.of("  "),
    bracketMatching(),
    sqlBracketsCompartment.of(sqlBracketsExtension(options.closeBrackets)),
    highlightSelectionMatches({ minSelectionLength: 2 }),
    sqlLanguageCompartment.of(sqlLanguage(options.engine)),
    Prec.high(syntaxHighlighting(dbmlHighlightStyle)),
    syntaxHighlighting(sqlHighlightStyle),
    sqlCompletionCompartment.of(sqlCompletionExtension(options.autoComplete)),
    placeholder(options.placeholder),
    EditorView.contentAttributes.of(() => ({ "aria-label": options.label() })),
    EditorView.lineWrapping,
    // Above everything else: Mod-Enter runs the statement even with the completion list open.
    Prec.highest(
      keymap.of([
        {
          key: "Mod-Enter",
          preventDefault: true,
          run: () => {
            options.onRun();
            return true;
          },
        },
      ]),
    ),
    // Tab is left alone on purpose: it leaves the field, as it did the textarea.
    keymap.of([
      { key: "Mod-i", run: startCompletion, preventDefault: true },
      { key: "Mod-z", run: undo, preventDefault: true },
      { key: "Mod-y", run: redo, preventDefault: true },
      { key: "Mod-Shift-z", run: redo, preventDefault: true },
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...historyKeymap,
      ...defaultKeymap,
    ]),
    // Before the shared theme, which it overrides where a field differs from a pane.
    sqlFieldTheme(options.compact),
    nebulaEditorTheme,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onChange(update.state.doc.toString());
    }),
  ];
}
