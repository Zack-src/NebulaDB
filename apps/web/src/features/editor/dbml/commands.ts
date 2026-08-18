import { EditorSelection, type ChangeSpec } from "@codemirror/state";
import { type Command, EditorView } from "@codemirror/view";
import { acceptCompletion } from "@codemirror/autocomplete";
import { indentLess, indentMore } from "@codemirror/commands";
import { getSymbols, tableAt } from "@/features/editor/dbml/symbols";

/** Adds a cursor on the line above/below every current cursor (Ctrl+Alt+Up/Down). */
function addCursorVertically(view: EditorView, dir: -1 | 1): boolean {
  const { state } = view;
  const ranges = state.selection.ranges.slice();
  let added = false;
  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.head);
    const targetNo = line.number + dir;
    if (targetNo < 1 || targetNo > state.doc.lines) continue;
    const target = state.doc.line(targetNo);
    const col = range.head - line.from;
    const pos = Math.min(target.from + col, target.to);
    if (ranges.some((r) => r.empty && r.head === pos)) continue;
    ranges.push(EditorSelection.cursor(pos));
    added = true;
  }
  if (!added) return false;
  view.dispatch({
    selection: EditorSelection.create(ranges, ranges.length - 1),
    scrollIntoView: true,
  });
  return true;
}

export const addCursorAbove: Command = (view) => addCursorVertically(view, -1);
export const addCursorBelow: Command = (view) => addCursorVertically(view, 1);

/** Puts a cursor at the end of every line covered by the selection (Shift+Alt+I). */
export const splitSelectionIntoLines: Command = (view) => {
  const { state } = view;
  const ranges: ReturnType<typeof EditorSelection.cursor>[] = [];
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) ranges.push(EditorSelection.cursor(state.doc.line(n).to));
  }
  if (ranges.length === 0) return false;
  view.dispatch({ selection: EditorSelection.create(ranges, ranges.length - 1) });
  return true;
};

/** Ctrl+L — select the current line, extending line by line when repeated. */
export const selectLineDown: Command = (view) => {
  const { state } = view;
  const ranges = state.selection.ranges.map((range) => {
    const start = state.doc.lineAt(range.from);
    const endLineNo = state.doc.lineAt(range.to).number;
    const alreadyWholeLines = range.from === start.from && range.to === state.doc.line(endLineNo).to;
    const lastNo = Math.min(state.doc.lines, alreadyWholeLines ? endLineNo + 1 : endLineNo);
    return EditorSelection.range(start.from, state.doc.line(lastNo).to);
  });
  view.dispatch({ selection: EditorSelection.create(ranges, state.selection.mainIndex), scrollIntoView: true });
  return true;
};

/** Ctrl+Shift+D — duplicate the selection (or the whole line when empty). */
export const duplicateSelection: Command = (view) => {
  const { state } = view;
  const changes: ChangeSpec[] = [];
  for (const range of state.selection.ranges) {
    if (range.empty) {
      const line = state.doc.lineAt(range.head);
      changes.push({ from: line.to, insert: "\n" + line.text });
    } else {
      changes.push({ from: range.to, insert: state.sliceDoc(range.from, range.to) });
    }
  }
  view.dispatch({ changes, scrollIntoView: true });
  return true;
};

/** Sorts the columns of the table under the cursor alphabetically, keeping `pk` columns first. */
export const sortTableColumns: Command = (view) => {
  const { state } = view;
  const symbols = getSymbols(state);
  const table = tableAt(symbols, state.doc, state.selection.main.head);
  if (!table || table.fields.length < 2) return false;

  const lines = table.fields.map((f) => ({ field: f, text: state.doc.line(f.line).text }));
  const contiguous = table.fields.every((f, i) => i === 0 || f.line === table.fields[i - 1].line + 1);
  if (!contiguous) return false;

  const sorted = [...lines].sort((a, b) => {
    if (a.field.pk !== b.field.pk) return a.field.pk ? -1 : 1;
    return a.field.name.localeCompare(b.field.name);
  });
  const from = state.doc.line(table.fields[0].line).from;
  const to = state.doc.line(table.fields[table.fields.length - 1].line).to;
  const insert = sorted.map((l) => l.text).join("\n");
  if (insert === state.sliceDoc(from, to)) return false;
  view.dispatch({ changes: { from, to, insert }, scrollIntoView: true });
  return true;
};

/** Ctrl+Shift+U / Ctrl+Shift+Alt+U — upper/lowercase every non-empty selection in place, cursors untouched. Empty selections (nothing to transform) are left alone rather than falling back to "the whole line", so the shortcut can't surprise-rewrite text the user never selected. */
function transformSelectionCase(view: EditorView, transform: (text: string) => string): boolean {
  const { state } = view;
  if (state.selection.ranges.every((r) => r.empty)) return false;
  const changes: ChangeSpec[] = state.selection.ranges
    .filter((r) => !r.empty)
    .map((r) => ({ from: r.from, to: r.to, insert: transform(state.sliceDoc(r.from, r.to)) }));
  view.dispatch({ changes, scrollIntoView: true });
  return true;
}

export const toUpperCaseSelection: Command = (view) => transformSelectionCase(view, (text) => text.toUpperCase());
export const toLowerCaseSelection: Command = (view) => transformSelectionCase(view, (text) => text.toLowerCase());

/** Tab: accept completion, else indent a multi-line selection, else insert two spaces. */
export const smartTab = {
  key: "Tab",
  run: (view: EditorView) => {
    if (acceptCompletion(view)) return true;
    const { state } = view;
    const multiLine = state.selection.ranges.some(
      (range) => state.doc.lineAt(range.from).number !== state.doc.lineAt(range.to).number,
    );
    if (multiLine) return indentMore(view);
    const primary = state.selection.main;
    const line = state.doc.lineAt(primary.head);
    if (/^\s*$/.test(line.text.slice(0, primary.head - line.from))) return indentMore(view);
    view.dispatch(state.replaceSelection("  "));
    return true;
  },
  shift: (view: EditorView) => indentLess(view),
};
