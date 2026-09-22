<script lang="ts" module>
  const MIN_FONT = 10;
  const MAX_FONT = 24;
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { EditorState } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import { foldAll as cmFoldAll, unfoldAll as cmUnfoldAll } from "@codemirror/language";
  import { openSearchPanel } from "@codemirror/search";
  import { openLintPanel } from "@codemirror/lint";
  import { formatDocument } from "@/features/editor/dbml/format";
  import { applyRename, type RenameRequest } from "@/features/editor/dbml/rename";
  import { applyServerProblem } from "@/features/editor/dbml/lint";
  import { createDbmlExtensions, documentSync, fontCompartment, fontTheme, wrapCompartment } from "@/features/editor/dbml/setup";
  import { getSymbols } from "@/features/editor/dbml/symbols";
  import { jumpTo } from "@/features/editor/dbml/navigation";
  import { matchShortcut } from "@/features/plugins/shortcuts";
  import CommandPalette from "@/features/editor/dbml/CommandPalette.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { EMPTY_CURSOR, readCursorInfo } from "./cursorInfo";
  import { readStoredFontSize, readStoredWrap, writeStoredFontSize, writeStoredWrap } from "./prefs";
  import { buildPaletteItems } from "./paletteItems";
  import { runPluginEditorCommand } from "./pluginCommands";
  import RenamePopover from "./RenamePopover.svelte";
  import StatusBar from "./StatusBar.svelte";
  import type { CursorInfo, DbmlEditorProps, PaletteItem, PluginEditorCommand, ViewRef } from "./types";

  let props: DbmlEditorProps = $props();

  const { t } = useTranslation();
  let container: HTMLDivElement;
  const viewRef: ViewRef = { current: null };

  // The open palette carries the entries it was built with. Snapshotting at
  // open time is what keeps the symbol list in step with the document: it is
  // read straight out of CodeMirror's live state, which no reactive derivation
  // can be invalidated against.
  let palette = $state.raw<{ mode: "symbols" | "commands"; items: PaletteItem[] } | null>(null);
  let rename = $state.raw<RenameRequest | null>(null);
  let renameValue = $state("");
  let cursor = $state.raw<CursorInfo>(EMPTY_CURSOR);
  let wrap = $state(readStoredWrap());
  let fontSize = $state(readStoredFontSize());

  function openRename(request: RenameRequest) {
    rename = request;
    renameValue = request.name;
  }

  function run(fn: (view: EditorView) => unknown) {
    const view = viewRef.current;
    if (!view) return;
    fn(view);
    view.focus();
  }

  /** For commands that open their own panel (search, go-to-line, problems) — refocusing the view would steal their input. */
  function runInPanel(fn: (view: EditorView) => unknown) {
    const view = viewRef.current;
    if (view) fn(view);
  }

  const increaseFont = () => (fontSize = Math.min(MAX_FONT, fontSize + 1));
  const decreaseFont = () => (fontSize = Math.max(MIN_FONT, fontSize - 1));

  const runPluginCommand = (command: PluginEditorCommand) =>
    runPluginEditorCommand(viewRef, command, (message, isError) => props.onPluginMessage?.(message, isError));

  function setPalette(mode: "symbols" | "commands" | null) {
    const view = viewRef.current;
    if (!mode || !view) {
      palette = null;
      return;
    }
    palette = {
      mode,
      items: buildPaletteItems(view, mode, {
        run,
        runInPanel,
        wrap,
        toggleWrap: () => (wrap = !wrap),
        increaseFont,
        decreaseFont,
        pluginCommands: props.pluginCommands,
        runPluginCommand,
        t,
      }),
    };
  }

  // Imperative handle for the panel header's buttons.
  export function format() {
    run(formatDocument);
  }
  export function openPalette(mode: "symbols" | "commands") {
    setPalette(mode);
  }
  export function search() {
    runInPanel(openSearchPanel);
  }
  export function foldAll() {
    run(cmFoldAll);
  }
  export function unfoldAll() {
    run(cmUnfoldAll);
  }
  export function focus() {
    viewRef.current?.focus();
  }

  // Owns the CodeMirror instance itself: created on mount, torn down on
  // destroy. Every callback it's given reads the *current* props at call time,
  // so the view never needs rebuilding when a handler changes.
  $effect(() => {
    const readOnly = untrack(() => props.readOnly);
    const state = EditorState.create({
      doc: untrack(() => props.value),
      extensions: createDbmlExtensions({
        lineWrap: readStoredWrap(),
        fontSize: readStoredFontSize(),
        onChange: (value) => props.onChange(value),
        onSave: () => props.onSave(),
        onPalette: (mode) => setPalette(mode),
        onRename: openRename,
        onNavigateToCanvas: (target) => props.onNavigateToCanvas?.(target),
      }).concat(
        // Both are needed: `readOnly` blocks programmatic edits through
        // transactions, `editable` also removes the caret and the "you can type
        // here" affordance.
        readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
        EditorView.updateListener.of((update) => {
          if (update.docChanged || update.selectionSet || update.transactions.length > 0) {
            cursor = readCursorInfo(update.view);
          }
        }),
      ),
    });
    const view = new EditorView({ state, parent: container });
    viewRef.current = view;
    cursor = readCursorInfo(view);
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  });

  // External document updates (project -> DBML sync).
  $effect(() => {
    const next = props.value;
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (next === current) return;

    // A schema resync (e.g. one attribute toggled on one column) used to
    // replace the *whole* buffer even though only a few characters actually
    // differ — CodeMirror then re-tokenizes and re-highlights the entire
    // document on every sync. Trimming to the smallest changed range keeps the
    // edit — and the resulting redraw — proportional to what actually changed.
    let start = 0;
    const maxStart = Math.min(current.length, next.length);
    while (start < maxStart && current.charCodeAt(start) === next.charCodeAt(start)) start++;
    let endCurrent = current.length;
    let endNext = next.length;
    while (endCurrent > start && endNext > start && current.charCodeAt(endCurrent - 1) === next.charCodeAt(endNext - 1)) {
      endCurrent--;
      endNext--;
    }

    view.dispatch({
      changes: { from: start, to: endCurrent, insert: next.slice(start, endNext) },
      selection: { anchor: Math.min(view.state.selection.main.anchor, next.length) },
      // Tagged so the change listener can tell this apart from typing: this is
      // the document being mirrored into the buffer, and echoing it back to
      // the server as an import is what made two connected clients fight over
      // the schema (see `documentSync` in ../setup.ts).
      annotations: documentSync.of(true),
    });
  });

  $effect(() => {
    const problem = props.problem ?? null;
    const view = viewRef.current;
    if (view) applyServerProblem(view, problem);
  });

  let lastScrollRequestId: number | null = null;
  $effect(() => {
    const request = props.scrollToTable;
    void props.value;
    const view = viewRef.current;
    if (!view || !request || lastScrollRequestId === request.requestId) return;
    const table = getSymbols(view.state).tableByName.get(request.tableName.toLowerCase());
    if (table) {
      jumpTo(view, table.nameSpan.from, { select: table.nameSpan });
      lastScrollRequestId = request.requestId;
    }
  });

  // Line-wrap and font-size preferences: persisted, and pushed into
  // CodeMirror's compartments.
  $effect(() => {
    const enabled = wrap;
    viewRef.current?.dispatch({ effects: wrapCompartment.reconfigure(enabled ? EditorView.lineWrapping : []) });
    writeStoredWrap(enabled);
  });
  $effect(() => {
    const size = fontSize;
    viewRef.current?.dispatch({ effects: fontCompartment.reconfigure(fontTheme(size)) });
    writeStoredFontSize(size);
  });

  // Ctrl/Cmd + wheel zooms the editor font. Registered with `{ passive: false }`
  // so `preventDefault()` actually stops the browser from zooming the page.
  $effect(() => {
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      fontSize = Math.max(MIN_FONT, Math.min(MAX_FONT, fontSize + (event.deltaY < 0 ? 1 : -1)));
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  });

  // Plugin shortcuts, bound on the editor container in the capture phase so
  // CodeMirror never swallows the combination first — and never on `window`,
  // so a plugin can't shadow a key combination while the user is elsewhere in
  // the app.
  $effect(() => {
    const commands = props.pluginCommands;
    if (!commands || commands.length === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const command = matchShortcut(commands, event);
      if (!command) return;
      event.preventDefault();
      event.stopPropagation();
      void runPluginCommand(command);
    };
    container.addEventListener("keydown", onKeyDown, true);
    return () => container.removeEventListener("keydown", onKeyDown, true);
  });

  function commitRename() {
    const view = viewRef.current;
    if (!view || !rename) return;
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== rename.name) applyRename(view, rename, trimmed);
    rename = null;
    view.focus();
  }
</script>

<div class="relative flex h-full min-h-0 flex-col">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div bind:this={container} class="min-h-0 flex-1 overflow-hidden" onkeydown={(event) => event.stopPropagation()}></div>

  {#if rename}
    <RenamePopover
      {rename}
      value={renameValue}
      onChange={(value) => (renameValue = value)}
      onCommit={commitRename}
      onCancel={() => {
        rename = null;
        viewRef.current?.focus();
      }}
      onDismiss={() => (rename = null)}
    />
  {/if}

  {#if palette}
    <CommandPalette
      items={palette.items}
      placeholder={palette.mode === "commands" ? t("dbml.palette.commandsPlaceholder") : t("dbml.palette.symbolsPlaceholder")}
      onClose={() => {
        palette = null;
        viewRef.current?.focus();
      }}
    />
  {/if}

  <StatusBar
    {cursor}
    {wrap}
    onToggleWrap={() => (wrap = !wrap)}
    {fontSize}
    onIncreaseFont={increaseFont}
    onDecreaseFont={decreaseFont}
    onShowProblems={() => runInPanel(openLintPanel)}
  />
</div>
