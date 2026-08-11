import { useCallback, useEffect, useState, type WheelEvent } from "react";
import { EditorView } from "@codemirror/view";
import { fontCompartment, fontTheme, wrapCompartment } from "@/features/editor/dbml/setup";
import { PREF_FONT, PREF_WRAP, readStoredFontSize, readStoredWrap } from "./prefs";
import type { ViewRef } from "./types";

const MIN_FONT = 10;
const MAX_FONT = 24;

/** Line-wrap and font-size preferences: state, persistence, and pushing changes into CodeMirror's compartments. */
export function useEditorPreferences(viewRef: ViewRef) {
  const [wrap, setWrap] = useState(readStoredWrap);
  const [fontSize, setFontSize] = useState(readStoredFontSize);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: wrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : []) });
    localStorage.setItem(PREF_WRAP, wrap ? "on" : "off");
  }, [wrap, viewRef]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: fontCompartment.reconfigure(fontTheme(fontSize)) });
    localStorage.setItem(PREF_FONT, String(fontSize));
  }, [fontSize, viewRef]);

  const increaseFont = useCallback(() => setFontSize((s) => Math.min(MAX_FONT, s + 1)), []);
  const decreaseFont = useCallback(() => setFontSize((s) => Math.max(MIN_FONT, s - 1)), []);

  /** Ctrl/Cmd + wheel zoom, bound directly on the editor container. */
  const onWheelZoom = useCallback((event: WheelEvent) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    setFontSize((s) => Math.max(MIN_FONT, Math.min(MAX_FONT, s + (event.deltaY < 0 ? 1 : -1))));
  }, []);

  return { wrap, setWrap, fontSize, setFontSize, increaseFont, decreaseFont, onWheelZoom };
}
