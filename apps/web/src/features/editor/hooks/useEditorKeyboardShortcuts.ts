import { useEffect } from "react";
import type * as Y from "yjs";

/** Ctrl/Cmd+Z (undo), +Shift+Z or +Y (redo), +D (duplicate selection) — ignored while typing in an input/editor. */
export function useEditorKeyboardShortcuts(undoManager: Y.UndoManager | null, duplicateSelected: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        Boolean(target.closest(".cm-editor, .nokey, [contenteditable='true']"))
      ) {
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) undoManager?.redo();
        else undoManager?.undo();
      } else if (key === "y") {
        event.preventDefault();
        undoManager?.redo();
      } else if (key === "d") {
        event.preventDefault();
        duplicateSelected();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undoManager, duplicateSelected]);
}
