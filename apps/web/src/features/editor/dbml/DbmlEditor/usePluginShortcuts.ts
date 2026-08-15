import { useCallback, useEffect, type RefObject } from "react";
import { matchShortcut } from "@/features/plugins/shortcuts";
import type { PluginEditorCommand, ViewRef } from "./types";

/**
 * Runs plugin-contributed editor commands against the live buffer, and binds
 * their shortcuts on the editor container (capture phase, so CodeMirror never
 * swallows the combination first — and never on `window`, so a plugin can't
 * shadow a key combination while the user is elsewhere in the app).
 */
export function usePluginShortcuts(
  containerRef: RefObject<HTMLDivElement | null>,
  viewRef: ViewRef,
  pluginCommands: PluginEditorCommand[] | undefined,
  onPluginMessage: ((message: string, isError?: boolean) => void) | undefined,
) {
  const runPluginCommand = useCallback(
    async (command: PluginEditorCommand) => {
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
    },
    [viewRef, onPluginMessage],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !pluginCommands || pluginCommands.length === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const command = matchShortcut(pluginCommands, event);
      if (!command) return;
      event.preventDefault();
      event.stopPropagation();
      void runPluginCommand(command);
    };
    el.addEventListener("keydown", onKeyDown, true);
    return () => el.removeEventListener("keydown", onKeyDown, true);
  }, [containerRef, pluginCommands, runPluginCommand]);

  return runPluginCommand;
}
