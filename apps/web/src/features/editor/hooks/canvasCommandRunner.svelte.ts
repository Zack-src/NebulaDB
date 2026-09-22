import type * as Y from "yjs";
import { writeProjectToDoc, type Project } from "@athanordb/shared";
import { useTranslation } from "@/i18n/i18n.svelte";
import { useFlashMessage } from "@/hooks/flashMessage.svelte";
import { matchShortcut } from "@/features/plugins/shortcuts";
import type { CanvasCommandContribution, CanvasCommandResult, ResolvedContribution } from "@/features/plugins/types";
import { AUTO_LAYOUT_ID, GROUP_TABLES_ID } from "@/features/plugins/builtins/coreCanvas";

/** How long a plugin command's status line stays on the canvas. */
const PLUGIN_MESSAGE_MS = 4000;

/**
 * Everything to do with *running* a canvas command — whether triggered from
 * a toolbar button, the plugin menu, or a keyboard shortcut — bundled in one
 * place: the transient status line, the run itself, the two toolbar shortcuts
 * (auto-layout, group tables) that are really just commands under the hood,
 * and the global keyboard-shortcut binding for plugin-defined commands.
 *
 * Must be called during component initialisation (it binds the shortcuts).
 */
export function useCanvasCommandRunner(options: {
  liveProject: () => Project | null;
  doc: () => Y.Doc | null;
  canWrite: () => boolean;
  canvasCommands: () => ResolvedContribution<CanvasCommandContribution>[];
  /** The canvas selection, read at the moment a command runs. */
  selectedTableIds: () => string[];
}) {
  const { t } = useTranslation();
  const status = useFlashMessage(PLUGIN_MESSAGE_MS);

  /**
   * Runs a plugin canvas command and writes back whatever project it returns.
   * `writeProjectToDoc` diffs entity by entity, so a command that only renames
   * one table produces exactly one Yjs update — and the change lands in every
   * collaborator's canvas through the normal sync path.
   */
  const runCanvasCommand = async (command: ResolvedContribution<CanvasCommandContribution>) => {
    const liveProject = options.liveProject();
    const doc = options.doc();
    if (!liveProject || !doc || !options.canWrite()) return;
    try {
      const selection = options.selectedTableIds();
      const result = (await command.run(liveProject, { selection })) as CanvasCommandResult;
      if (result?.project) doc.transact(() => writeProjectToDoc(doc, result.project as Project));
      status.flash(result?.message ?? t("plugins.commandApplied", { command: command.contribution.label }));
    } catch (err) {
      status.flash(t("plugins.errorPrefix", { message: err instanceof Error ? err.message : String(err) }));
    }
  };

  // Auto-layout and table-grouping are the `athanordb.core-canvas` plugin's
  // canvasCommands (see coreCanvas.ts) — these just run them through the same
  // path every other canvas command uses. If the plugin providing one is
  // disabled, its button quietly does nothing, same as any other command.
  const runCanvasCommandById = (id: string) => {
    const command = options.canvasCommands().find((c) => c.contribution.id === id);
    if (command) void runCanvasCommand(command);
  };

  /**
   * Global bindings for plugin canvas commands. The app's own shortcuts are
   * bound elsewhere and run first; anything typed into a field or the DBML
   * editor is left alone.
   */
  $effect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, .cm-editor, [contenteditable='true']")) return;
      const command = matchShortcut(
        options.canvasCommands().map((c) => ({ command: c, shortcut: c.contribution.shortcut })),
        event,
      )?.command;
      if (!command) return;
      event.preventDefault();
      void runCanvasCommand(command);
    };
    // Capture phase: a focused canvas node stops keydown from bubbling to the
    // window (it handles arrows/delete itself), so a bubble-phase listener
    // never fires for the exact case these shortcuts are most useful in —
    // right after clicking a table.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  return {
    get pluginMessage() {
      return status.message;
    },
    runCanvasCommand,
    runCanvasCommandById,
    onAutoLayout: () => runCanvasCommandById(AUTO_LAYOUT_ID),
    onGroupTables: () => runCanvasCommandById(GROUP_TABLES_ID),
  };
}
