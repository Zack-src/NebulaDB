import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { foldAll, unfoldAll } from "@codemirror/language";
import { openSearchPanel } from "@codemirror/search";
import { openLintPanel } from "@codemirror/lint";
import { formatDocument } from "@/features/editor/dbml/format";
import { applyRename, type RenameRequest } from "@/features/editor/dbml/rename";
import { CommandPalette, type PaletteItem } from "@/features/editor/dbml/CommandPalette";
import { useTranslation } from "@/i18n/useTranslation";
import { EMPTY_CURSOR } from "./cursorInfo";
import { useEditorLifecycle } from "./useEditorLifecycle";
import { useEditorPreferences } from "./useEditorPreferences";
import { usePluginShortcuts } from "./usePluginShortcuts";
import { usePaletteItems } from "./usePaletteItems";
import { RenamePopover } from "./RenamePopover";
import { StatusBar } from "./StatusBar";
import type { CursorInfo, DbmlEditorHandle, DbmlEditorProps, PluginEditorCommand } from "./types";

export type { DbmlEditorHandle, PluginEditorCommand };

export const DbmlEditor = forwardRef<DbmlEditorHandle, DbmlEditorProps>(function DbmlEditor(props, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  const { t } = useTranslation();
  // The open palette carries the entries it was built with. Snapshotting at
  // open time is what keeps the symbol list in step with the document: it is
  // read straight out of CodeMirror's live state, which React has no way to
  // invalidate a memo against.
  const [palette, setPalette] = useState<{ mode: "symbols" | "commands"; items: PaletteItem[] } | null>(null);
  const [rename, setRename] = useState<RenameRequest | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [cursor, setCursor] = useState<CursorInfo>(EMPTY_CURSOR);

  const openRename = useCallback((request: RenameRequest) => {
    setRename(request);
    setRenameValue(request.name);
  }, []);

  // Stable identity, because the editor's mount-only effect captures this once
  // and would otherwise hold the very first closure forever; the builder it
  // calls is kept fresh through a ref instead.
  const buildPaletteItemsRef = useRef<((view: EditorView, mode: "symbols" | "commands") => PaletteItem[]) | null>(null);
  const openPalette = useCallback((mode: "symbols" | "commands" | null) => {
    const view = viewRef.current;
    const build = buildPaletteItemsRef.current;
    if (!mode || !view || !build) {
      setPalette(null);
      return;
    }
    setPalette({ mode, items: build(view, mode) });
  }, []);

  useEditorLifecycle(props, containerRef, viewRef, setCursor, openPalette, openRename);
  const { wrap, setWrap, fontSize, increaseFont, decreaseFont } = useEditorPreferences(viewRef, containerRef);

  const run = useCallback((fn: (view: EditorView) => unknown) => {
    const view = viewRef.current;
    if (!view) return;
    fn(view);
    view.focus();
  }, []);

  /** For commands that open their own panel (search, go-to-line, problems) — refocusing the view would steal their input. */
  const runInPanel = useCallback((fn: (view: EditorView) => unknown) => {
    const view = viewRef.current;
    if (view) fn(view);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      format: () => run(formatDocument),
      openPalette: (mode) => openPalette(mode),
      search: () => runInPanel(openSearchPanel),
      foldAll: () => run(foldAll),
      unfoldAll: () => run(unfoldAll),
      focus: () => viewRef.current?.focus(),
    }),
    [run, runInPanel, openPalette],
  );

  const { pluginCommands, onPluginMessage } = props;
  const runPluginCommand = usePluginShortcuts(containerRef, viewRef, pluginCommands, onPluginMessage);

  const buildPaletteItems = usePaletteItems({
    run,
    runInPanel,
    wrap,
    setWrap,
    increaseFont,
    decreaseFont,
    pluginCommands,
    runPluginCommand,
    t,
  });
  useEffect(() => {
    buildPaletteItemsRef.current = buildPaletteItems;
  }, [buildPaletteItems]);

  const commitRename = () => {
    const view = viewRef.current;
    if (!view || !rename) return;
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== rename.name) applyRename(view, rename, trimmed);
    setRename(null);
    view.focus();
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden" onKeyDown={(event) => event.stopPropagation()} />

      {rename && (
        <RenamePopover
          rename={rename}
          value={renameValue}
          onChange={setRenameValue}
          onCommit={commitRename}
          onCancel={() => {
            setRename(null);
            viewRef.current?.focus();
          }}
          onDismiss={() => setRename(null)}
        />
      )}

      {palette && (
        <CommandPalette
          items={palette.items}
          placeholder={palette.mode === "commands" ? t("dbml.palette.commandsPlaceholder") : t("dbml.palette.symbolsPlaceholder")}
          onClose={() => {
            setPalette(null);
            viewRef.current?.focus();
          }}
        />
      )}

      <StatusBar
        cursor={cursor}
        wrap={wrap}
        onToggleWrap={() => setWrap((w) => !w)}
        fontSize={fontSize}
        onIncreaseFont={increaseFont}
        onDecreaseFont={decreaseFont}
        onShowProblems={() => runInPanel(openLintPanel)}
      />
    </div>
  );
});
