import { useCallback, useEffect, useState, type RefObject } from "react";
import { EditorView } from "@codemirror/view";
import { fontCompartment, fontTheme, wrapCompartment } from "@/features/editor/dbml/setup";
import { readStoredFontSize, readStoredWrap, writeStoredFontSize, writeStoredWrap } from "./prefs";
import type { ViewRef } from "./types";

const MIN_FONT = 10;
const MAX_FONT = 24;

/** Line-wrap and font-size preferences: state, persistence, and pushing changes into CodeMirror's compartments. */
export function useEditorPreferences(viewRef: ViewRef, containerRef: RefObject<HTMLDivElement | null>) {
  const [wrap, setWrap] = useState(readStoredWrap);
  const [fontSize, setFontSize] = useState(readStoredFontSize);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: wrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : []) });
    writeStoredWrap(wrap);
  }, [wrap, viewRef]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: fontCompartment.reconfigure(fontTheme(fontSize)) });
    writeStoredFontSize(fontSize);
  }, [fontSize, viewRef]);

  const increaseFont = useCallback(() => setFontSize((s) => Math.min(MAX_FONT, s + 1)), []);
  const decreaseFont = useCallback(() => setFontSize((s) => Math.max(MIN_FONT, s - 1)), []);

  /**
   * Ctrl/Cmd + wheel zooms the editor font.
   *
   * Registered here with `{ passive: false }` rather than through a JSX
   * `onWheel` prop: React attaches `wheel` on the root container as a *passive*
   * listener, so `preventDefault()` from a synthetic handler is ignored and the
   * browser went ahead and zoomed the entire page instead.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: globalThis.WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      setFontSize((size) => Math.max(MIN_FONT, Math.min(MAX_FONT, size + (event.deltaY < 0 ? 1 : -1))));
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [containerRef]);

  return { wrap, setWrap, fontSize, setFontSize, increaseFont, decreaseFont };
}
