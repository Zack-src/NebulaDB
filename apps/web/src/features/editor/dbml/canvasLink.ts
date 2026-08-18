import { Facet, type EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getSymbols, tableAt } from "@/features/editor/dbml/symbols";

export interface CanvasNavigateTarget {
  tableName: string;
  /** Set only when the click landed on one of the table's own field lines, not just anywhere in its block. */
  fieldName?: string;
}

/** Double-click on a table or one of its columns -> jump to it on the canvas. Set by `DbmlEditorOptions.onNavigateToCanvas`. */
export const canvasNavigateHandler = Facet.define<(target: CanvasNavigateTarget) => void>();

/**
 * Resolves a document position to the table (and column, if it landed on
 * one) whose block contains it. Takes `EditorState` rather than the full
 * `EditorView` (same convention as `navigation.ts`'s `resolveDefinition`) —
 * decouples it from anything DOM-dependent, so it's plain, testable logic.
 */
export function tableFieldAt(state: EditorState, pos: number): CanvasNavigateTarget | null {
  const symbols = getSymbols(state);
  const table = tableAt(symbols, state.doc, pos);
  if (!table) return null;
  const lineNo = state.doc.lineAt(pos).number;
  const field = table.fields.find((f) => f.line === lineNo);
  return { tableName: table.name, fieldName: field?.name };
}

/**
 * Never claims the event (`domEventHandlers` return `false`) — CodeMirror's
 * own double-click-select-word behaviour still happens, same as a plain
 * double-click anywhere else in the buffer; jumping to the canvas is a
 * side effect layered on top, not a replacement gesture (unlike Ctrl-click's
 * `dbmlNavigation`, which does take over the click entirely).
 */
export const dbmlCanvasLink: Extension = EditorView.domEventHandlers({
  dblclick(event, view) {
    const handler = view.state.facet(canvasNavigateHandler)[0];
    if (!handler) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;
    const target = tableFieldAt(view.state, pos);
    if (target) handler(target);
    return false;
  },
});
