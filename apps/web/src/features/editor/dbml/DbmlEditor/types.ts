import type { MutableRefObject } from "react";
import type { EditorView } from "@codemirror/view";

export interface DbmlEditorHandle {
  format: () => void;
  openPalette: (mode: "symbols" | "commands") => void;
  search: () => void;
  foldAll: () => void;
  unfoldAll: () => void;
  focus: () => void;
}

/**
 * An editor command contributed by a plugin. It never touches CodeMirror: it
 * receives the buffer plus the current selection and returns the replacement
 * buffer, which keeps plugin code independent of the editor implementation.
 */
export interface PluginEditorCommand {
  key: string;
  label: string;
  detail?: string;
  /** e.g. `"Ctrl+Alt+S"` — bound while the editor has focus, never globally. */
  shortcut?: string;
  run: (input: {
    text: string;
    selection: { from: number; to: number };
    selectedText: string;
  }) => Promise<{ text?: string | null; message?: string }>;
}

export interface CursorInfo {
  line: number;
  column: number;
  selected: number;
  cursors: number;
  breadcrumb: string | null;
  errors: number;
  warnings: number;
}

export interface DbmlEditorProps {
  value: string;
  /** Renders the buffer but refuses edits — used for a `view` grant, where typed changes would be discarded by the server anyway. */
  readOnly?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  problem?: import("@/features/editor/dbml/lint").ServerProblem | null;
  scrollToTable?: { tableName: string; requestId: number } | null;
  /** Double-click on a table/column in the buffer -> jump to it on the canvas. */
  onNavigateToCanvas?: (target: import("@/features/editor/dbml/canvasLink").CanvasNavigateTarget) => void;
  pluginCommands?: PluginEditorCommand[];
  onPluginMessage?: (message: string, isError?: boolean) => void;
}

export type ViewRef = MutableRefObject<EditorView | null>;
