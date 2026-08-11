import { StateEffect, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { forceLinting, linter, type Diagnostic } from "@codemirror/lint";
import { DBML_TYPES } from "@/features/editor/dbml/language";
import { getSymbols, type Span } from "@/features/editor/dbml/symbols";

export interface ServerProblem {
  message: string;
  line: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

export const setServerProblem = StateEffect.define<ServerProblem | null>();

export const serverProblemField = StateField.define<ServerProblem | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setServerProblem)) return e.value;
    return value;
  },
});

/** Pushes the backend parse error into the editor's diagnostics and refreshes the gutter. */
export function applyServerProblem(view: EditorView, problem: ServerProblem | null) {
  view.dispatch({ effects: setServerProblem.of(problem) });
  forceLinting(view);
}

const KNOWN_TYPES = new Set(DBML_TYPES.map((t) => t.toLowerCase()));

function spanOfLine(view: EditorView, lineNumber: number): Span {
  const line = view.state.doc.line(Math.min(Math.max(1, lineNumber), view.state.doc.lines));
  const start = line.from + (line.text.length - line.text.trimStart().length);
  return { from: start, to: Math.max(start + 1, line.to) };
}

/**
 * Static analysis run on every edit: relationship targets that don't exist,
 * duplicate declarations, unknown column types, unbalanced blocks — plus the
 * last error reported by the backend importer.
 */
export const dbmlLinter = linter(
  (view) => {
    const diagnostics: Diagnostic[] = [];
    const state = view.state;
    const symbols = getSymbols(state);
    const doc = state.doc;

    const push = (span: Span, severity: Diagnostic["severity"], message: string, source = "dbml") => {
      const from = Math.max(0, Math.min(span.from, doc.length));
      const to = Math.max(from + (doc.length > from ? 1 : 0), Math.min(span.to, doc.length));
      diagnostics.push({ from, to, severity, message, source });
    };

    // duplicate tables / aliases
    const seenTables = new Map<string, number>();
    for (const table of symbols.tables) {
      const key = `${table.schema ?? ""}.${table.name}`.toLowerCase();
      const prev = seenTables.get(key);
      if (prev != null) push(table.nameSpan, "error", `Table "${table.name}" is already defined on line ${prev}.`);
      else seenTables.set(key, table.line);

      // duplicate columns
      const seenFields = new Map<string, number>();
      for (const field of table.fields) {
        const fkey = field.name.toLowerCase();
        const prevField = seenFields.get(fkey);
        if (prevField != null) {
          push(field.nameSpan, "error", `Column "${field.name}" is already defined on line ${prevField}.`);
        } else {
          seenFields.set(fkey, field.line);
        }

        const baseType = field.type.replace(/\(.*$/, "").replace(/\[\]$/, "").toLowerCase();
        if (
          baseType &&
          !KNOWN_TYPES.has(baseType) &&
          !symbols.enumByName.has(baseType) &&
          !field.type.startsWith('"')
        ) {
          push(field.typeSpan, "warning", `Unknown type "${field.type}". Not a built-in type nor a declared Enum.`);
        }

        for (const inline of field.inlineRefs) {
          const target = symbols.tableByName.get(inline.table.toLowerCase());
          if (!target) {
            push(inline.span, "error", `Unknown table "${inline.table}" in inline ref.`);
          } else if (!target.fields.some((f) => f.name.toLowerCase() === inline.field.toLowerCase())) {
            push(inline.span, "error", `Table "${target.name}" has no column "${inline.field}".`);
          }
        }
      }

      if (table.fields.length === 0) {
        push(table.nameSpan, "warning", `Table "${table.name}" has no columns.`);
      }
    }

    // duplicate enums
    const seenEnums = new Map<string, number>();
    for (const e of symbols.enums) {
      const prev = seenEnums.get(e.name.toLowerCase());
      if (prev != null) push(e.nameSpan, "error", `Enum "${e.name}" is already defined on line ${prev}.`);
      else seenEnums.set(e.name.toLowerCase(), e.line);
    }

    // relationship endpoints
    for (const ref of symbols.refs) {
      for (const endpoint of [ref.left, ref.right]) {
        const table = symbols.tableByName.get(endpoint.table.toLowerCase());
        if (!table) {
          push(endpoint.tableSpan, "error", `Unknown table "${endpoint.table}".`);
          continue;
        }
        for (const fieldName of endpoint.fields) {
          if (!table.fields.some((f) => f.name.toLowerCase() === fieldName.toLowerCase())) {
            push(
              endpoint.fieldSpan.to > endpoint.fieldSpan.from ? endpoint.fieldSpan : endpoint.tableSpan,
              "error",
              `Table "${table.name}" has no column "${fieldName}".`,
            );
          }
        }
      }
      if (ref.left.fields.length !== ref.right.fields.length) {
        push(spanOfLine(view, ref.line), "warning", "Both sides of a composite relationship must list the same number of columns.");
      }
    }

    // table groups
    for (const group of symbols.groups) {
      for (const member of group.members) {
        if (!symbols.tableByName.has(member.name.toLowerCase())) {
          push(member.span, "warning", `TableGroup "${group.name}" references unknown table "${member.name}".`);
        }
      }
    }

    // structure
    if (symbols.danglingOpen != null) {
      push(spanOfLine(view, symbols.danglingOpen), "error", "Unclosed block — missing `}`.");
    }
    for (const line of symbols.strayClose) {
      push(spanOfLine(view, line), "error", "Unexpected `}` — no block is open here.");
    }

    // backend importer error
    const problem = state.field(serverProblemField, false);
    if (problem) {
      const line = doc.line(Math.min(Math.max(1, problem.line), doc.lines));
      const from = Math.min(line.from + Math.max(0, (problem.column ?? 1) - 1), line.to);
      const endLine = doc.line(Math.min(Math.max(1, problem.endLine ?? problem.line), doc.lines));
      const rawTo = endLine.from + Math.max(0, (problem.endColumn ?? (problem.column ?? 1) + 1) - 1);
      push({ from, to: Math.max(from + 1, rawTo) }, "error", problem.message, "dbml-parser");
    }

    return diagnostics;
  },
  {
    delay: 400,
    // the backend error arrives as an effect, not a doc change — without this
    // the linter would keep showing the diagnostics of the previous run
    needsRefresh: (update) => update.transactions.some((tr) => tr.effects.some((event) => event.is(setServerProblem))),
  },
);

export const dbmlLint = [serverProblemField, dbmlLinter];
