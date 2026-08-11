import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "@athanordb/shared";
import { projectToDbml } from "@athanordb/dbml-engine";
import { ChevronLeftIcon, CodeIcon, LayoutGridIcon, SettingsIcon } from "@/components/icons/Icons";
import { DbmlEditor, type DbmlEditorHandle, type PluginEditorCommand } from "@/features/editor/dbml/DbmlEditor";
import { useEditorCommands } from "@/features/plugins/usePlugins";
import type { EditorCommandResult } from "@/features/plugins/types";
import type { ServerProblem } from "@/features/editor/dbml/lint";
import { dbmlSignature } from "@/features/editor/dbml/symbols";
import { Button } from "@/components/ui/Button";
import { ErrorText } from "@/components/ui/Alert";
import { useTranslation } from "@/i18n/useTranslation";
import { ApiError } from "@/services/ApiError";
import { exportDbml, importSource } from "@/services/projectsApi";


const DBML_SYNC_DEBOUNCE_MS = 600;
const DEFAULT_PANEL_WIDTH = 440;
const MIN_PANEL_WIDTH = 280;
const STORAGE_KEY_WIDTH = "athanordb_dbml_panel_width";

export interface DbmlErrorPos {
  line: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

/** The format name, not prose — never translated. */
const DBML_LABEL = "DBML";

function DbmlPanel(props: {
  project: Project;
  projectId: string;
  onClose: () => void;
  scrollToTable?: { tableName: string; requestId: number } | null;
}) {
  const { t } = useTranslation();
  const { project, projectId } = props;
  const editorCommands = useEditorCommands(projectId);
  const [pluginMessage, setPluginMessage] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<ServerProblem | null>(null);
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_WIDTH);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= MIN_PANEL_WIDTH) return parsed;
    }
    return DEFAULT_PANEL_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(dirty);
  const lastAppliedTextRef = useRef<string | null>(null);
  const editorRef = useRef<DbmlEditorHandle | null>(null);
  /** Mirror of `text` for Ctrl+S, which fires outside React's render cycle. */
  const textRef = useRef(text);

  const startResizing = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      setIsResizing(true);
      const startX = event.clientX;
      const startWidth = panelWidth;

      const clamp = (deltaX: number) => {
        const maxWidth = Math.min(1200, window.innerWidth - 100);
        return Math.max(MIN_PANEL_WIDTH, Math.min(maxWidth, startWidth + deltaX));
      };

      const onMouseMove = (moveEvent: MouseEvent) => setPanelWidth(clamp(moveEvent.clientX - startX));
      const onMouseUp = (upEvent: MouseEvent) => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        setIsResizing(false);
        localStorage.setItem(STORAGE_KEY_WIDTH, String(clamp(upEvent.clientX - startX)));
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [panelWidth],
  );

  const handleDoubleClickResizer = useCallback(() => {
    setPanelWidth(DEFAULT_PANEL_WIDTH);
    localStorage.setItem(STORAGE_KEY_WIDTH, String(DEFAULT_PANEL_WIDTH));
  }, []);

  /** Signature of the buffer, and a one-slot cache for the generated one — the
   * project object changes on every canvas interaction (a table drag included),
   * so this runs far more often than the document actually changes. */
  const textSignature = useMemo(() => dbmlSignature(text), [text]);
  const generatedSignatureRef = useRef<{ source: string; signature: string } | null>(null);
  const signatureOf = useCallback((source: string) => {
    const cached = generatedSignatureRef.current;
    if (cached?.source === source) return cached.signature;
    const signature = dbmlSignature(source);
    generatedSignatureRef.current = { source, signature };
    return signature;
  }, []);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  // Fetch initial DBML content
  useEffect(() => {
    exportDbml(projectId)
      .then((dbml) => {
        setText(dbml);
        lastAppliedTextRef.current = dbml;
      })
      .catch((err: unknown) => {
        // The one sync failure that's actually blocking (nothing loaded at
        // all, nothing to fall back to visually) still gets a message —
        // everything else in this file is transient and just logged.
        console.error("[dbml] failed to load initial DBML:", err);
        setError(t("dbml.loadFailed"));
      });
  }, [projectId, t]);

  // Sync live project changes (e.g. node/ref deletions or modifications) into DBML text.
  // `projectToDbml` re-serializes the whole schema in its own canonical layout, so
  // adopting it blindly would throw away the buffer's formatting and comments a few
  // hundred ms after every edit. Only replace the text when the schema actually
  // differs from what the buffer already declares.
  useEffect(() => {
    if (dirtyRef.current) return;

    const adopt = (dbml: string) => {
      if (dirtyRef.current || lastAppliedTextRef.current === dbml || text === dbml) return;
      if (signatureOf(dbml) === textSignature) {
        // same schema, different layout — keep what the user is looking at
        lastAppliedTextRef.current = dbml;
        return;
      }
      setText(dbml);
      lastAppliedTextRef.current = dbml;
    };

    try {
      adopt(projectToDbml(project));
    } catch (err) {
      // Background reconciliation, not a user action — log it and retry via
      // the server's own serializer rather than surfacing it as an error.
      console.error("[dbml] client-side re-serialization failed, falling back to server export:", err);
      exportDbml(projectId)
        .then(adopt)
        .catch((fallbackErr: unknown) => console.error("[dbml] fallback export also failed:", fallbackErr));
    }
  }, [project, projectId, text, textSignature, signatureOf]);

  const applyNow = useCallback(
    (source: string) => {
      lastAppliedTextRef.current = source;
      importSource(projectId, source)
        .then(() => {
          setDirty(false);
          setError(null);
          setProblem(null);
        })
        .catch((err: unknown) => {
          const parseFailure = err instanceof ApiError && typeof err.details.line === "number";
          if (parseFailure) {
            // A real DBML validation problem — actionable, stays visible next
            // to the editor (not a transport/sync failure). The server's own
            // diagnostic is used verbatim: it names the offending token.
            const { line, column, endLine, endColumn } = (err as ApiError).details as Record<string, number>;
            setError((err as ApiError).message);
            setProblem({ message: (err as ApiError).message, line, column, endLine, endColumn });
            return;
          }
          // Rejected for some other reason (permissions, a malformed request,
          // a dropped connection) — not something typing more DBML fixes, so
          // it isn't shown as an editor error; logged for debugging instead.
          console.error("[dbml] sync rejected:", err);
          setError(null);
          setProblem(null);
        });
    },
    [projectId],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleChange = useCallback(
    (value: string) => {
      setText(value);
      setDirty(true);
      setError(null);
      setProblem(null);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => applyNow(value), DBML_SYNC_DEBOUNCE_MS);
    },
    [applyNow],
  );

  /** Ctrl+S — skip the debounce and push the current buffer immediately. */
  const handleSave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    applyNow(textRef.current);
  }, [applyNow]);

  /** Plugin editor commands, adapted to what `DbmlEditor` needs (text in, text out). */
  const pluginCommands = useMemo(
    (): PluginEditorCommand[] =>
      editorCommands.map((command) => ({
        key: command.key,
        label: command.contribution.label,
        detail: command.source === "user" ? command.plugin.name : undefined,
        shortcut: command.contribution.shortcut,
        run: async (input) => (await command.run(input)) as EditorCommandResult,
      })),
    [editorCommands],
  );

  const handlePluginMessage = useCallback((message: string, isError?: boolean) => {
    setPluginMessage(`${isError ? "Plugin error: " : ""}${message}`);
    setTimeout(() => setPluginMessage(null), 4000);
  }, []);

  return (
    <div className="relative flex shrink-0 flex-col border-r border-border bg-surface nokey" style={{ width: panelWidth }}>
      <div
        className={`absolute bottom-0 right-[-4px] top-0 z-20 w-2 cursor-col-resize transition-colors duration-150 ${isResizing ? "bg-primary" : "hover:bg-primary"}`}
        onMouseDown={startResizing}
        onDoubleClick={handleDoubleClickResizer}
        data-tooltip={t("dbml.resizeHint")}
      />
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
        <CodeIcon size={14} className="text-text-muted" />
        <span className="text-[13px] font-semibold text-text">{DBML_LABEL}</span>
        {pluginMessage && <span className="truncate text-[11.5px] text-text-muted">{pluginMessage}</span>}
        <span className="ml-auto" />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => editorRef.current?.openPalette("symbols")}
          data-tooltip={t("dbml.goToSymbol")}
        >
          <LayoutGridIcon size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => editorRef.current?.openPalette("commands")}
          data-tooltip={t("dbml.commandPalette")}
        >
          <SettingsIcon size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => editorRef.current?.format()}
          data-tooltip={t("dbml.formatDocument")}
        >
          {t("dbml.format")}
        </Button>
        <Button variant="ghost" size="icon" onClick={props.onClose} data-tooltip={t("dbml.collapse")}>
          <ChevronLeftIcon size={16} />
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <DbmlEditor
          ref={editorRef}
          value={text}
          onChange={handleChange}
          onSave={handleSave}
          problem={problem}
          scrollToTable={props.scrollToTable}
          pluginCommands={pluginCommands}
          onPluginMessage={handlePluginMessage}
        />
      </div>
      {error && (
        <div className="m-2">
          <ErrorText>
            {problem ? `Line ${problem.line}${problem.column ? `, col ${problem.column}` : ""} — ${error}` : error}
          </ErrorText>
        </div>
      )}
    </div>
  );
}

export { DbmlPanel };
export default DbmlPanel;
