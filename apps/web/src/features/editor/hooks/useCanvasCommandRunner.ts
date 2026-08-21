import { useCallback, useEffect, useRef } from "react";
import type * as Y from "yjs";
import { writeProjectToDoc, type Project } from "@athanordb/shared";
import { useTranslation } from "@/i18n/useTranslation";
import { useFlashMessage } from "@/hooks/useFlashMessage";
import { matchShortcut } from "@/features/plugins/shortcuts";
import type { CanvasCommandContribution, CanvasCommandResult, ResolvedContribution } from "@/features/plugins/types";
import { AUTO_LAYOUT_ID, GROUP_TABLES_ID } from "@/features/plugins/builtins/coreCanvas";

/** How long a plugin command's status line stays on the canvas. */
const PLUGIN_MESSAGE_MS = 4000;

/**
 * Everything to do with *running* a canvas command — whether triggered from
 * a toolbar button, the plugin menu, or a keyboard shortcut — bundled into
 * one hook: the transient status line, the run itself, the two toolbar
 * shortcuts (auto-layout, group tables) that are really just commands under
 * the hood, and the global keyboard-shortcut binding for plugin-defined
 * commands. Split out of `ProjectEditor` because all of it is one concern
 * that component only ever *triggers*, never inspects.
 */
export function useCanvasCommandRunner({
  liveProject,
  doc,
  canWrite,
  canvasCommands,
  selectedTableIds,
}: {
  liveProject: Project | null;
  doc: Y.Doc | null;
  canWrite: boolean;
  canvasCommands: ResolvedContribution<CanvasCommandContribution>[];
  selectedTableIds: string[];
}) {
  const { t } = useTranslation();
  const { message: pluginMessage, flash } = useFlashMessage(PLUGIN_MESSAGE_MS);

  /**
   * The canvas selection, held in a ref rather than a dependency: a command
   * reads it at the moment it runs, and re-creating `runCanvasCommand` on
   * every selection change would re-render the whole canvas toolbar.
   */
  const selectedTableIdsRef = useRef<string[]>([]);
  useEffect(() => {
    selectedTableIdsRef.current = selectedTableIds;
  }, [selectedTableIds]);

  /**
   * Runs a plugin canvas command and writes back whatever project it returns.
   * `writeProjectToDoc` diffs entity by entity, so a command that only renames
   * one table produces exactly one Yjs update — and the change lands in every
   * collaborator's canvas through the normal sync path.
   */
  const runCanvasCommand = useCallback(
    async (command: ResolvedContribution<CanvasCommandContribution>) => {
      if (!liveProject || !doc || !canWrite) return;
      try {
        const selection = selectedTableIdsRef.current;
        const result = (await command.run(liveProject, { selection })) as CanvasCommandResult;
        if (result?.project) doc.transact(() => writeProjectToDoc(doc, result.project as Project));
        flash(result?.message ?? t("plugins.commandApplied", { command: command.contribution.label }));
      } catch (err) {
        flash(t("plugins.errorPrefix", { message: err instanceof Error ? err.message : String(err) }));
      }
    },
    [liveProject, doc, canWrite, flash, t],
  );

  // Auto-layout and table-grouping are the `athanordb.core-canvas` plugin's
  // `auto-layout`/`group-tables` canvasCommands (see coreCanvas.ts) — these
  // just run them through the same path every other canvas command uses,
  // rather than calling a bespoke doc mutation. If the plugin providing one
  // is disabled, its button quietly does nothing, same as any other canvas
  // command would.
  const runCanvasCommandById = useCallback(
    (id: string) => {
      const command = canvasCommands.find((c) => c.contribution.id === id);
      if (command) void runCanvasCommand(command);
    },
    [canvasCommands, runCanvasCommand],
  );
  const onAutoLayout = useCallback(() => runCanvasCommandById(AUTO_LAYOUT_ID), [runCanvasCommandById]);
  const onGroupTables = useCallback(() => runCanvasCommandById(GROUP_TABLES_ID), [runCanvasCommandById]);

  /**
   * Global bindings for plugin canvas commands. The app's own shortcuts are
   * bound elsewhere and run first; anything typed into a field or the DBML
   * editor is left alone.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, .cm-editor, [contenteditable='true']")) return;
      const command = matchShortcut(
        canvasCommands.map((c) => ({ command: c, shortcut: c.contribution.shortcut })),
        event,
      )?.command;
      if (!command) return;
      event.preventDefault();
      void runCanvasCommand(command);
    };
    // Capture phase: a focused React Flow node stops keydown from bubbling to
    // the window (it handles arrows/delete itself), so a bubble-phase listener
    // never fires for the exact case these shortcuts are most useful in —
    // right after clicking a table.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [canvasCommands, runCanvasCommand]);

  return { pluginMessage, runCanvasCommand, runCanvasCommandById, onAutoLayout, onGroupTables };
}
