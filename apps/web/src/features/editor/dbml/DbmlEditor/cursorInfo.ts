import type { EditorView } from "@codemirror/view";
import { forEachDiagnostic } from "@codemirror/lint";
import { getSymbols } from "@/features/editor/dbml/symbols";
import type { CursorInfo } from "./types";

export const EMPTY_CURSOR: CursorInfo = {
  line: 1,
  column: 1,
  selected: 0,
  cursors: 1,
  breadcrumb: null,
  errors: 0,
  warnings: 0,
};

export function readCursorInfo(view: EditorView): CursorInfo {
  const state = view.state;
  const main = state.selection.main;
  const line = state.doc.lineAt(main.head);
  const symbols = getSymbols(state);
  const table = symbols.tables.find((t) => line.number >= t.line && line.number <= t.endLine);
  let errors = 0;
  let warnings = 0;
  forEachDiagnostic(state, (d) => {
    if (d.severity === "error") errors += 1;
    else if (d.severity === "warning") warnings += 1;
  });
  return {
    line: line.number,
    column: main.head - line.from + 1,
    selected: state.selection.ranges.reduce((sum, r) => sum + (r.to - r.from), 0),
    cursors: state.selection.ranges.length,
    breadcrumb: table ? table.name : null,
    errors,
    warnings,
  };
}
