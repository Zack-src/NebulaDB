import { useMemo } from "react";
import type { EditorView } from "@codemirror/view";
import { foldAll, unfoldAll } from "@codemirror/language";
import { gotoLine, openSearchPanel, selectNextOccurrence } from "@codemirror/search";
import { nextDiagnostic, openLintPanel } from "@codemirror/lint";
import { getSymbols } from "@/features/editor/dbml/symbols";
import { jumpTo, jumpToLine, goToDefinition, navigateBack, navigateForward } from "@/features/editor/dbml/navigation";
import { formatDocument } from "@/features/editor/dbml/format";
import { startRename } from "@/features/editor/dbml/rename";
import { duplicateSelection, sortTableColumns } from "@/features/editor/dbml/commands";
import type { PaletteItem } from "@/features/editor/dbml/CommandPalette";
import type { useTranslation } from "@/i18n/useTranslation";
import type { PluginEditorCommand, ViewRef } from "./types";

type Translate = ReturnType<typeof useTranslation>["t"];

/** Builds the flat list of entries shown by the command palette, for both its "symbols" and "commands" modes. */
export function usePaletteItems(options: {
  viewRef: ViewRef;
  palette: "symbols" | "commands" | null;
  run: (fn: (view: EditorView) => unknown) => void;
  runInPanel: (fn: (view: EditorView) => unknown) => void;
  wrap: boolean;
  setWrap: (fn: (w: boolean) => boolean) => void;
  increaseFont: () => void;
  decreaseFont: () => void;
  pluginCommands: PluginEditorCommand[] | undefined;
  runPluginCommand: (command: PluginEditorCommand) => void;
  t: Translate;
}): PaletteItem[] {
  const { viewRef, palette, run, runInPanel, wrap, setWrap, increaseFont, decreaseFont, pluginCommands, runPluginCommand, t } = options;

  return useMemo((): PaletteItem[] => {
    const view = viewRef.current;
    if (!view || !palette) return [];

    if (palette === "commands") {
      const commands: Array<[string, string, (view: EditorView) => unknown, boolean?]> = [
        ["Format document", "Shift+Alt+F", formatDocument],
        ["Sort columns of current table", "Ctrl+Alt+O", sortTableColumns],
        ["Go to definition", "F12", goToDefinition],
        ["Rename symbol", "F2", startRename],
        ["Select next occurrence", "Ctrl+D", selectNextOccurrence],
        ["Duplicate selection", "Ctrl+Shift+D", duplicateSelection],
        ["Find / replace", "Ctrl+F", openSearchPanel, true],
        ["Go to line", "Ctrl+G", gotoLine, true],
        ["Next problem", "F8", nextDiagnostic],
        ["Show problems panel", "Ctrl+Shift+M", openLintPanel, true],
        ["Fold all", "Ctrl+K Ctrl+0", foldAll],
        ["Unfold all", "Ctrl+K Ctrl+J", unfoldAll],
        ["Navigate back", "Alt+←", navigateBack],
        ["Navigate forward", "Alt+→", navigateForward],
      ];
      return [
        ...commands.map(([label, hint, fn, opensPanel]) => ({
          id: label,
          label,
          hint,
          kind: "cmd",
          run: () => (opensPanel ? runInPanel(fn) : run(fn)),
        })),
        {
          id: "toggle-wrap",
          label: wrap ? "Disable line wrapping" : "Enable line wrapping",
          kind: "cmd",
          run: () => setWrap((w) => !w),
        },
        { id: "font-in", label: t("dbml.fontIncrease"), hint: "Ctrl+=", kind: "cmd", run: increaseFont },
        { id: "font-out", label: t("dbml.fontDecrease"), hint: "Ctrl+-", kind: "cmd", run: decreaseFont },
        ...(pluginCommands ?? []).map((command) => ({
          id: `plugin:${command.key}`,
          label: command.label,
          kind: "plugin",
          detail: command.detail,
          hint: command.shortcut,
          run: () => void runPluginCommand(command),
        })),
      ];
    }

    const symbols = getSymbols(view.state);
    const items: PaletteItem[] = [];
    for (const table of symbols.tables) {
      items.push({
        id: `table:${table.name}`,
        label: table.name,
        kind: "table",
        detail: `${table.fields.length} col`,
        hint: `L${table.line}`,
        run: () => run((v) => jumpTo(v, table.nameSpan.from, { select: table.nameSpan })),
      });
      for (const field of table.fields) {
        items.push({
          id: `field:${table.name}.${field.name}`,
          label: `${table.name}.${field.name}`,
          kind: field.pk ? "pk" : "col",
          detail: field.type,
          hint: `L${field.line}`,
          run: () => run((v) => jumpTo(v, field.nameSpan.from, { select: field.nameSpan })),
        });
      }
    }
    for (const e of symbols.enums) {
      items.push({
        id: `enum:${e.name}`,
        label: e.name,
        kind: "enum",
        detail: `${e.values.length} values`,
        hint: `L${e.line}`,
        run: () => run((v) => jumpTo(v, e.nameSpan.from, { select: e.nameSpan })),
      });
    }
    for (const group of symbols.groups) {
      items.push({
        id: `group:${group.name}`,
        label: group.name,
        kind: "group",
        detail: `${group.members.length} tables`,
        hint: `L${group.line}`,
        run: () => run((v) => jumpToLine(v, group.line)),
      });
    }
    for (const ref of symbols.refs) {
      const label = `${ref.left.table}.${ref.left.fields.join(",")} ${ref.relation} ${ref.right.table}.${ref.right.fields.join(",")}`;
      items.push({
        id: `ref:${label}:${ref.line}`,
        label,
        kind: "ref",
        hint: `L${ref.line}`,
        run: () => run((v) => jumpToLine(v, ref.line)),
      });
    }
    return items;
  }, [viewRef, palette, run, runInPanel, wrap, setWrap, increaseFont, decreaseFont, pluginCommands, runPluginCommand, t]);
}
