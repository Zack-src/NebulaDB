import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { applyServerProblem } from "@/features/editor/dbml/lint";
import { createDbmlExtensions, documentSync } from "@/features/editor/dbml/setup";
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
  props: Pick<
    DbmlEditorProps,
    "value" | "readOnly" | "onChange" | "onSave" | "problem" | "scrollToTable" | "onNavigateToCanvas"
  >,
  containerRef: React.RefObject<HTMLDivElement | null>,
  viewRef: ViewRef,
  setCursor: (info: CursorInfo) => void,
  setPalette: (mode: "symbols" | "commands" | null) => void,
  openRename: (request: RenameRequest) => void,
) {
  const onChangeRef = useRef(props.onChange);
  const onSaveRef = useRef(props.onSave);
  const readOnlyRef = useRef(props.readOnly);
  const onNavigateToCanvasRef = useRef(props.onNavigateToCanvas);
  // Latest-callback refs, refreshed after commit rather than during render:
  // CodeMirror only calls them from user events, which always come after paint,
  // so an effect is early enough — and writing a ref while rendering is exactly
  // the pattern React's own lint rules flag as unsafe under concurrent renders.
  useEffect(() => {
    onChangeRef.current = props.onChange;
    onSaveRef.current = props.onSave;
    onNavigateToCanvasRef.current = props.onNavigateToCanvas;
  }, [props.onChange, props.onSave, props.onNavigateToCanvas]);

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
        onNavigateToCanvas: (target) => onNavigateToCanvasRef.current?.(target),
      }).concat(
        // Both are needed: `readOnly` blocks programmatic edits through
        // transactions, `editable` also removes the caret and the "you can type
        // here" affordance.
        readOnlyRef.current ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
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
    const next = props.value;
    if (next === current) return;

    // A schema resync (e.g. one attribute toggled on one column) used to
    // replace the *whole* buffer (`from: 0, to: current.length`) even though
    // only a few characters actually differ — CodeMirror then re-tokenizes
    // and re-highlights the entire document on every sync, which is why the
    // DBML pane visibly lagged behind the toggle button (an isolated,
    // constant-cost DOM update) on anything but a tiny schema. Trimming to
    // the smallest changed range keeps the edit — and the resulting
    // re-render — proportional to what actually changed.
    let start = 0;
    const maxStart = Math.min(current.length, next.length);
    while (start < maxStart && current.charCodeAt(start) === next.charCodeAt(start)) start++;
    let endCurrent = current.length;
    let endNext = next.length;
    while (
      endCurrent > start &&
      endNext > start &&
      current.charCodeAt(endCurrent - 1) === next.charCodeAt(endNext - 1)
    ) {
      endCurrent--;
      endNext--;
    }

    view.dispatch({
      changes: { from: start, to: endCurrent, insert: next.slice(start, endNext) },
      selection: { anchor: Math.min(view.state.selection.main.anchor, next.length) },
      // Tagged so the change listener can tell this apart from typing: this is
      // the document being mirrored into the buffer, and echoing it back to
      // the server as an import is what made two connected clients fight over
      // the schema (see `documentSync` in ../setup.ts).
      annotations: documentSync.of(true),
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
