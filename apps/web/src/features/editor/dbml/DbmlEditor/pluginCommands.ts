import type { PluginEditorCommand, ViewRef } from "./types";

/**
 * Runs a plugin-contributed editor command against the live buffer. The
 * plugin never touches CodeMirror: it gets the text and selection, and hands
 * back the replacement text (applied here as one change) and/or a message.
 */
export async function runPluginEditorCommand(
  viewRef: ViewRef,
  command: PluginEditorCommand,
  onPluginMessage: ((message: string, isError?: boolean) => void) | undefined,
): Promise<void> {
  const view = viewRef.current;
  if (!view) return;
  const { state } = view;
  const selection = { from: state.selection.main.from, to: state.selection.main.to };
  const text = state.doc.toString();
  try {
    const result = await command.run({
      text,
      selection,
      selectedText: state.sliceDoc(selection.from, selection.to),
    });
    const next = result?.text;
    if (typeof next === "string" && next !== view.state.doc.toString()) {
      const current = view.state.doc.length;
      view.dispatch({
        changes: { from: 0, to: current, insert: next },
        selection: { anchor: Math.min(state.selection.main.anchor, next.length) },
      });
    }
    if (result?.message) onPluginMessage?.(result.message);
  } catch (err) {
    onPluginMessage?.(err instanceof Error ? err.message : String(err), true);
  }
  view.focus();
}
