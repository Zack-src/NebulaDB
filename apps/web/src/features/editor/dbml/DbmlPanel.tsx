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
import type { TranslationKeyOf } from "@/types";
import { exportDbml, importSource } from "@/services/projectsApi";
import { time } from "@/utils/perfMonitor";
import {
  DBML_PANEL_WIDTH_DEFAULT,
  DBML_PANEL_WIDTH_MAX,
  DBML_PANEL_WIDTH_MIN,
  loadDbmlPanelWidth,
  saveDbmlPanelWidth,
} from "@/utils/preferences";

const DBML_SYNC_DEBOUNCE_MS = 600;
/** How long a plugin's status line stays up before it clears itself. */
const PLUGIN_MESSAGE_MS = 4000;

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
  /** True for a `view` grant — the buffer still shows the live schema, but nothing typed into it is sent. */
  readOnly?: boolean;
  onClose: () => void;
  scrollToTable?: { tableName: string; requestId: number } | null;
  onNavigateToCanvas?: (target: { tableName: string; fieldName?: string }) => void;
}) {
  const { t } = useTranslation();
  const { project, projectId, readOnly = false } = props;
  const editorCommands = useEditorCommands(projectId);
  const [pluginMessage, setPluginMessage] = useState<string | null>(null);
  const [text, setText] = useState<string>(() => {
    try {
      return time("dbml.serialize", () => projectToDbml(project));
    } catch {
      return "";
    }
  });
  const [dirty, setDirty] = useState(false);
  /**
   * Two kinds of error live side by side here, and they are stored differently
   * on purpose. `error` holds a message the *server* wrote (a DBML diagnostic
   * naming the offending token) which is passed through verbatim. `errorKey`
   * holds one of ours, kept as a key so it re-renders in the user's language
   * when they switch locale rather than freezing in whichever was active when
   * it was raised.
   */
  const [error, setError] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<TranslationKeyOf | null>(null);
  const [problem, setProblem] = useState<ServerProblem | null>(null);
  const [panelWidth, setPanelWidth] = useState<number>(loadDbmlPanelWidth);
  const [isResizing, setIsResizing] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(dirty);
  const lastAppliedTextRef = useRef<string | null>(text);
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
        const maxWidth = Math.min(DBML_PANEL_WIDTH_MAX, window.innerWidth - 100);
        return Math.max(DBML_PANEL_WIDTH_MIN, Math.min(maxWidth, startWidth + deltaX));
      };

      const onMouseMove = (moveEvent: MouseEvent) => setPanelWidth(clamp(moveEvent.clientX - startX));
      const onMouseUp = (upEvent: MouseEvent) => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        setIsResizing(false);
        saveDbmlPanelWidth(clamp(upEvent.clientX - startX));
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [panelWidth],
  );

  const handleDoubleClickResizer = useCallback(() => {
    setPanelWidth(DBML_PANEL_WIDTH_DEFAULT);
    saveDbmlPanelWidth(DBML_PANEL_WIDTH_DEFAULT);
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

  // Sync live project changes (e.g. node/ref deletions or modifications) into DBML text.
  // `projectToDbml` re-serializes the whole schema in its own canonical layout, so
  // adopting it blindly would throw away the buffer's formatting and comments a few
  // hundred ms after every edit. Only replace the text when the schema actually
  // differs from what the buffer already declares.
  useEffect(() => {
    if (dirtyRef.current) return;

    const adopt = (dbml: string) => {
      if (dirtyRef.current || lastAppliedTextRef.current === dbml || text === dbml) return;
      if (time("dbml.signature", () => signatureOf(dbml)) === textSignature) {
        // same schema, different layout — keep what the user is looking at
        lastAppliedTextRef.current = dbml;
        return;
      }
      setText(dbml);
      lastAppliedTextRef.current = dbml;
    };

    try {
      adopt(time("dbml.serialize", () => projectToDbml(project)));
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
      if (readOnly) return;
      // The document-derived text this buffer was edited on top of — the
      // server needs it to tell a deletion apart from a table it simply
      // never had (a collaborator's, added while this buffer was open).
      const baseline = lastAppliedTextRef.current ?? undefined;
      lastAppliedTextRef.current = source;
      importSource(projectId, source, undefined, baseline)
        .then(() => {
          setDirty(false);
          setError(null);
          setErrorKey(null);
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
          setErrorKey(null);
          setProblem(null);
        });
    },
    [projectId, readOnly],
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
      setErrorKey(null);
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

  // The timer is tracked so a second message replaces the first rather than
  // being wiped by the first one's expiry — two commands can legitimately emit
  // the same text, so comparing the message itself would not be enough.
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlePluginMessage = useCallback(
    (message: string, isError?: boolean) => {
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
      setPluginMessage(isError ? t("plugins.errorPrefix", { message }) : message);
      messageTimerRef.current = setTimeout(() => setPluginMessage(null), PLUGIN_MESSAGE_MS);
    },
    [t],
  );

  useEffect(
    () => () => {
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    },
    [],
  );

  return (
    <div
      className="relative flex shrink-0 flex-col border-r border-border bg-surface nokey"
      style={{ width: panelWidth }}
    >
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
          readOnly={readOnly}
          onChange={handleChange}
          onSave={handleSave}
          problem={problem}
          scrollToTable={props.scrollToTable}
          onNavigateToCanvas={props.onNavigateToCanvas}
          pluginCommands={pluginCommands}
          onPluginMessage={handlePluginMessage}
        />
      </div>
      {(error || errorKey) && (
        <div className="m-2">
          <ErrorText>
            {errorKey
              ? t(errorKey)
              : problem
                ? `${t("dbml.problemAt", { line: problem.line, column: problem.column ?? "" })} — ${error}`
                : error}
          </ErrorText>
        </div>
      )}
    </div>
  );
}

export { DbmlPanel };
export default DbmlPanel;
