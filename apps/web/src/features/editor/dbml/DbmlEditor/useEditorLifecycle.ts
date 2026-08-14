import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { applyServerProblem } from "@/features/editor/dbml/lint";
import { createDbmlExtensions } from "@/features/editor/dbml/setup";
import { getSymbols } from "@/features/editor/dbml/symbols";
import { jumpTo } from "@/features/editor/dbml/navigation";
import type { RenameRequest } from "@/features/editor/dbml/rename";
import { readCursorInfo } from "./cursorInfo";
import { readStoredFontSize, readStoredWrap } from "./prefs";
import type { CursorInfo, DbmlEditorProps, ViewRef } from "./types";

/**
 * Owns the CodeMirror instance itself: creates it on mount, tears it down on
 * unmount, and keeps it in sync with the props that describe external state
 * (document value, server-reported problems, "scroll to this table" requests).
 * Editor *preferences* (wrap, font size) live in `useEditorPreferences`.
 */
export function useEditorLifecycle(
  props: Pick<DbmlEditorProps, "value" | "onChange" | "onSave" | "problem" | "scrollToTable">,
  containerRef: React.RefObject<HTMLDivElement | null>,
  viewRef: ViewRef,
  setCursor: (info: CursorInfo) => void,
  setPalette: (mode: "symbols" | "commands" | null) => void,
  openRename: (request: RenameRequest) => void,
) {
  const onChangeRef = useRef(props.onChange);
  const onSaveRef = useRef(props.onSave);
  // Latest-callback refs, refreshed after commit rather than during render:
  // CodeMirror only calls them from user events, which always come after paint,
  // so an effect is early enough — and writing a ref while rendering is exactly
  // the pattern React's own lint rules flag as unsafe under concurrent renders.
  useEffect(() => {
    onChangeRef.current = props.onChange;
    onSaveRef.current = props.onSave;
  }, [props.onChange, props.onSave]);

  useEffect(() => {
    if (!containerRef.current) return;
    const state = EditorState.create({
      doc: props.value,
      extensions: createDbmlExtensions({
        lineWrap: readStoredWrap(),
        fontSize: readStoredFontSize(),
        onChange: (value) => onChangeRef.current(value),
        onSave: () => onSaveRef.current(),
        onPalette: (mode) => setPalette(mode),
        onRename: openRename,
      }).concat(
        EditorView.updateListener.of((update) => {
          if (update.docChanged || update.selectionSet || update.transactions.length > 0) {
            setCursor(readCursorInfo(update.view));
          }
        }),
      ),
    });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    setCursor(readCursorInfo(view));
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // external document updates (project -> DBML sync)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (props.value === current) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: props.value },
      selection: { anchor: Math.min(view.state.selection.main.anchor, props.value.length) },
    });
  }, [props.value, viewRef]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) applyServerProblem(view, props.problem ?? null);
  }, [props.problem, viewRef]);

  const lastRequestRef = useRef<number | null>(null);
  useEffect(() => {
    const view = viewRef.current;
    const request = props.scrollToTable;
    if (!view || !request || lastRequestRef.current === request.requestId) return;
    const table = getSymbols(view.state).tableByName.get(request.tableName.toLowerCase());
    if (table) {
      jumpTo(view, table.nameSpan.from, { select: table.nameSpan });
      lastRequestRef.current = request.requestId;
    }
  }, [props.scrollToTable, props.value, viewRef]);
}
