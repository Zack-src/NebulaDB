import { EditorSelection } from "@codemirror/state";
import type { Command } from "@codemirror/view";
import { formatDbml } from "@athanordb/dbml-engine";

export { formatDbml };

/** Shift+Alt+F — reformat the document, keeping the cursor on the same line. */
export const formatDocument: Command = (view) => {
  const current = view.state.doc.toString();
  const formatted = formatDbml(current);
  if (formatted === current) return true;
  const lineNumber = view.state.doc.lineAt(view.state.selection.main.head).number;
  view.dispatch({
    changes: { from: 0, to: current.length, insert: formatted },
    selection: EditorSelection.cursor(0),
    scrollIntoView: true,
  });
  const target = view.state.doc.line(Math.min(lineNumber, view.state.doc.lines));
  view.dispatch({ selection: EditorSelection.cursor(target.from), scrollIntoView: true });
  return true;
};
