import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { foldAll, unfoldAll } from "@codemirror/language";
import { openSearchPanel, gotoLine, selectNextOccurrence } from "@codemirror/search";
import { forEachDiagnostic, nextDiagnostic, openLintPanel } from "@codemirror/lint";
import { applyServerProblem, type ServerProblem } from "@/features/editor/dbml/lint";
import { createDbmlExtensions, fontCompartment, fontTheme, wrapCompartment } from "@/features/editor/dbml/setup";
import { getSymbols } from "@/features/editor/dbml/symbols";
import { goToDefinition, jumpTo, jumpToLine, navigateBack, navigateForward } from "@/features/editor/dbml/navigation";
import { formatDocument } from "@/features/editor/dbml/format";
import { applyRename, startRename, type RenameRequest } from "@/features/editor/dbml/rename";
import { duplicateSelection, sortTableColumns } from "@/features/editor/dbml/commands";
import { CommandPalette, type PaletteItem } from "@/features/editor/dbml/CommandPalette";
import { matchShortcut } from "@/features/plugins/shortcuts";
import { useTranslation } from "@/i18n/useTranslation";

const PREF_WRAP = "athanordb_dbml_wrap";
const PREF_FONT = "athanordb_dbml_font_size";

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

interface CursorInfo {
  line: number;
  column: number;
  selected: number;
  cursors: number;
  breadcrumb: string | null;
  errors: number;
  warnings: number;
}

const EMPTY_CURSOR: CursorInfo = { line: 1, column: 1, selected: 0, cursors: 1, breadcrumb: null, errors: 0, warnings: 0 };

function readCursorInfo(view: EditorView): CursorInfo {
  const state = view.state;
  const main = state.selection.main;
  const line = state.doc.lineAt(main.head);
  const symbols = getSymbols(state);
  const table = symbols.tables.find((t) => line.number >= t.line && line.number <= t.endLine);
  let errors = 0;
  let warnings = 0;
  forEachDiagnostic(state, (d) => {
    if (d.severity === "error") errors += 1;
    else if (d.severity === "warning") warnings += 1;
  });
  return {
    line: line.number,
    column: main.head - line.from + 1,
    selected: state.selection.ranges.reduce((sum, r) => sum + (r.to - r.from), 0),
    cursors: state.selection.ranges.length,
    breadcrumb: table ? table.name : null,
    errors,
    warnings,
  };
}

export const DbmlEditor = forwardRef<
  DbmlEditorHandle,
  {
    value: string;
    onChange: (value: string) => void;
    onSave: () => void;
    problem?: ServerProblem | null;
    scrollToTable?: { tableName: string; requestId: number } | null;
    pluginCommands?: PluginEditorCommand[];
    onPluginMessage?: (message: string, isError?: boolean) => void;
  }
>(function DbmlEditor(props, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(props.onChange);
  const onSaveRef = useRef(props.onSave);
  onChangeRef.current = props.onChange;
  onSaveRef.current = props.onSave;

  const { t } = useTranslation();
  const [palette, setPalette] = useState<"symbols" | "commands" | null>(null);
  const [rename, setRename] = useState<RenameRequest | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [cursor, setCursor] = useState<CursorInfo>(EMPTY_CURSOR);
  const [wrap, setWrap] = useState(() => localStorage.getItem(PREF_WRAP) !== "off");
  const [fontSize, setFontSize] = useState(() => {
    const saved = Number(localStorage.getItem(PREF_FONT));
    return Number.isFinite(saved) && saved >= 10 && saved <= 24 ? saved : 13;
  });

  const openRename = useCallback((request: RenameRequest) => {
    setRename(request);
    setRenameValue(request.name);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const state = EditorState.create({
      doc: props.value,
      extensions: createDbmlExtensions({
        lineWrap: localStorage.getItem(PREF_WRAP) !== "off",
        fontSize: Number(localStorage.getItem(PREF_FONT)) || 13,
        onChange: (value) => onChangeRef.current(value),
        onSave: () => onSaveRef.current(),
        onPalette: (mode) => setPalette(mode),
        onRename: openRename,
      }).concat(
        EditorView.updateListener.of((update) => {
          if (update.docChanged || update.selectionSet || update.transactions.length > 0) {
            setCursor(readCursorInfo(update.view));
          }
        }),
      ),
    });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    setCursor(readCursorInfo(view));
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // external document updates (project -> DBML sync)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (props.value === current) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: props.value },
      selection: { anchor: Math.min(view.state.selection.main.anchor, props.value.length) },
    });
  }, [props.value]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) applyServerProblem(view, props.problem ?? null);
  }, [props.problem]);

  const lastRequestRef = useRef<number | null>(null);
  useEffect(() => {
    const view = viewRef.current;
    const request = props.scrollToTable;
    if (!view || !request || lastRequestRef.current === request.requestId) return;
    const table = getSymbols(view.state).tableByName.get(request.tableName.toLowerCase());
    if (table) {
      jumpTo(view, table.nameSpan.from, { select: table.nameSpan });
      lastRequestRef.current = request.requestId;
    }
  }, [props.scrollToTable, props.value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: wrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : []) });
    localStorage.setItem(PREF_WRAP, wrap ? "on" : "off");
  }, [wrap]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: fontCompartment.reconfigure(fontTheme(fontSize)) });
    localStorage.setItem(PREF_FONT, String(fontSize));
  }, [fontSize]);

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
      openPalette: (mode) => setPalette(mode),
      search: () => runInPanel(openSearchPanel),
      foldAll: () => run(foldAll),
      unfoldAll: () => run(unfoldAll),
      focus: () => viewRef.current?.focus(),
    }),
    [run, runInPanel],
  );

  const { pluginCommands, onPluginMessage } = props;

  /** Runs a plugin editor command against the live buffer and adopts what it returns. */
  const runPluginCommand = useCallback(
    async (command: PluginEditorCommand) => {
      const view = viewRef.current;
      if (!view) return;
      const { state } = view;
      const selection = { from: state.selection.main.from, to: state.selection.main.to };
      const text = state.doc.toString();
      try {
        const result = await command.run({ text, selection, selectedText: state.sliceDoc(selection.from, selection.to) });
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
    [onPluginMessage],
  );

  /**
   * Plugin editor shortcuts, bound on the editor container rather than the
   * window: a plugin must not be able to shadow a key combination while the
   * user is somewhere else in the app.
   */
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
    // Capture phase, for the same reason as the canvas: CodeMirror handles
    // keydown on the editor itself and would swallow the combination first.
    el.addEventListener("keydown", onKeyDown, true);
    return () => el.removeEventListener("keydown", onKeyDown, true);
  }, [pluginCommands, runPluginCommand]);

  const paletteItems = useMemo((): PaletteItem[] => {
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
        { id: "font-in", label: t("dbml.fontIncrease"), hint: "Ctrl+=", kind: "cmd", run: () => setFontSize((s) => Math.min(24, s + 1)) },
        { id: "font-out", label: t("dbml.fontDecrease"), hint: "Ctrl+-", kind: "cmd", run: () => setFontSize((s) => Math.max(10, s - 1)) },
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
  }, [palette, run, runInPanel, wrap, pluginCommands, runPluginCommand, t]);

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
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-hidden"
        onKeyDown={(event) => event.stopPropagation()}
        onWheel={(event) => {
          if (!(event.ctrlKey || event.metaKey)) return;
          event.preventDefault();
          setFontSize((s) => Math.max(10, Math.min(24, s + (event.deltaY < 0 ? 1 : -1))));
        }}
      />

      {rename && (
        <div className="absolute left-1/2 top-6 z-40 w-[86%] -translate-x-1/2 rounded-lg border border-border bg-surface p-2 shadow-2xl">
          <div className="mb-1 px-1 text-[11px] text-text-muted">
            {t("dbml.renameSummary", {
              kind: rename.kind,
              owner: rename.owner ?? "",
              count: rename.occurrences,
            })}
          </div>
          <input
            autoFocus
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                commitRename();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setRename(null);
                viewRef.current?.focus();
              }
            }}
            onBlur={() => setRename(null)}
            className="w-full rounded border border-border bg-bg px-2 py-1 text-[13px] text-text outline-none focus:border-primary"
          />
        </div>
      )}

      {palette && (
        <CommandPalette
          items={paletteItems}
          placeholder={palette === "commands" ? "Type a command…" : "Go to table, column, enum or relationship…"}
          onClose={() => {
            setPalette(null);
            viewRef.current?.focus();
          }}
        />
      )}

      <div className="flex shrink-0 items-center gap-3 border-t border-border bg-surface px-2.5 py-1 text-[11px] text-text-muted">
        <span title={t("dbml.lineColumn")}>
          Ln {cursor.line}, Col {cursor.column}
        </span>
        {cursor.selected > 0 && <span>{t("dbml.selectedChars", { count: cursor.selected })}</span>}
        {cursor.cursors > 1 && <span className="text-primary">{t("dbml.cursorCount", { count: cursor.cursors })}</span>}
        {cursor.breadcrumb && (
          <span className="truncate" title={t("dbml.currentTable")}>
            › {cursor.breadcrumb}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {(cursor.errors > 0 || cursor.warnings > 0) && (
            <button
              type="button"
              onClick={() => runInPanel(openLintPanel)}
              className="rounded px-1 hover:bg-surface-hover"
              title={t("dbml.showProblems")}
            >
              <span className={cursor.errors ? "text-danger" : ""}>✕ {cursor.errors}</span>{" "}
              <span className={cursor.warnings ? "text-warning" : ""}>⚠ {cursor.warnings}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setWrap((w) => !w)}
            className="rounded px-1 hover:bg-surface-hover"
            title={t("dbml.toggleWrap")}
          >
            {t(wrap ? "dbml.wrapOn" : "dbml.wrapOff")}
          </button>
          <button
            type="button"
            onClick={() => setFontSize((s) => Math.max(10, s - 1))}
            className="rounded px-1 hover:bg-surface-hover"
            title={t("dbml.fontDecrease")}
          >
            A−
          </button>
          <span>{fontSize}px</span>
          <button
            type="button"
            onClick={() => setFontSize((s) => Math.min(24, s + 1))}
            className="rounded px-1 hover:bg-surface-hover"
            title={t("dbml.fontIncrease")}
          >
            A+
          </button>
          <span title={t("dbml.indentation")}>{t("dbml.twoSpaces")}</span>
        </span>
      </div>
    </div>
  );
});
