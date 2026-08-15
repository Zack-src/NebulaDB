import { useEffect } from "react";
import type * as Y from "yjs";
import { isTypingTarget } from "@/utils/dom";

/** Ctrl/Cmd+Z (undo), +Shift+Z or +Y (redo), +D (duplicate selection) — ignored while typing in an input/editor, and entirely inert on a read-only project. */
export function useEditorKeyboardShortcuts(
  undoManager: Y.UndoManager | null,
  duplicateSelected: () => void,
  canWrite = true,
) {
  useEffect(() => {
    if (!canWrite) return;
    const handler = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
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
  }, [undoManager, duplicateSelected, canWrite]);
}
