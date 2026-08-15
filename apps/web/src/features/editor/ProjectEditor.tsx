import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { getMetaMap, writeProjectToDoc, type Project } from "@athanordb/shared";
import { useProjectDoc } from "@/features/collaboration/useProjectDoc";
import { useAwarenessStates } from "@/features/collaboration/useAwarenessStates";
import { hashColor } from "@/features/collaboration/awarenessColor";
import { CanvasArea } from "@/features/editor/canvas/CanvasArea";
import { ChevronRightIcon } from "@/components/icons/Icons";
import { DEFAULT_PALETTE } from "@/components/inputs/ColorSwatchPicker";
import { loadHighlightLinks, saveHighlightLinks } from "@/utils/preferences";
import type { CanvasExportHandle, ProjectSummary } from "@/types/index";
import { useCanvasNodes } from "@/features/editor/hooks/useCanvasNodes";
import { useCanvasEdges } from "@/features/editor/hooks/useCanvasEdges";
import { useCursorNodes } from "@/features/editor/hooks/useCursorNodes";
import { useCanvasFontScale } from "@/features/editor/hooks/useCanvasFontScale";
import { useProjectMutations } from "@/features/editor/hooks/useProjectMutations";
import { useEditorKeyboardShortcuts } from "@/features/editor/hooks/useEditorKeyboardShortcuts";
import { ProjectToolbar } from "@/features/editor/ProjectToolbar";
import { useTranslation } from "@/i18n/useTranslation";
import { useCanvasCommands } from "@/features/plugins/usePlugins";
import { matchShortcut } from "@/features/plugins/shortcuts";
import type { CanvasCommandResult } from "@/features/plugins/types";

import DbmlPanel from "@/features/editor/dbml/DbmlPanel";
const ImportDialog = lazy(() => import("@/features/editor/io/ImportDialog"));
const ExportDialog = lazy(() => import("@/features/editor/io/ExportDialog"));
const HistoryPanel = lazy(() => import("@/features/editor/history/HistoryPanel"));
const PluginManagerDialog = lazy(() => import("@/features/plugins/PluginManagerDialog"));

/** How long a plugin command's status line stays on the canvas. */
const PLUGIN_MESSAGE_MS = 4000;

import { SettingsModal } from "@/features/settings/SettingsModal";
import type { Session } from "@/types/index";

export function ProjectEditor(props: {
  project: ProjectSummary;
  session: Session;
  onDisplayNameChange: (name: string) => Promise<void>;
  onLogout: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const { project, session } = props;
  const user = session.displayName;
  /**
   * A `view` grant is enforced by the server, which simply drops the Yjs
   * updates it receives from a read-only connection — silently, with no
   * rejection frame. So without a client-side gate the whole editor stayed
   * live: tables dragged, DBML typed, buttons worked, and every change
   * vanished on reload with nothing ever having said no. Everything that can
   * write to the document is gated on this.
   */
  const canWrite = project.permission !== "view";
  const {
    project: liveProject,
    doc,
    undoManager,
    awareness,
    connection,
  } = useProjectDoc(project.id, project.name, user);
  /** Handed to the write paths in place of `doc`: every mutator already early-returns on a null doc, so one substitution closes all of them at once. */
  const writeDoc = canWrite ? doc : null;
  const remoteAwareness = useAwarenessStates(awareness);
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [dbmlOpen, setDbmlOpen] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showPlugins, setShowPlugins] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [pluginMessage, setPluginMessage] = useState<string | null>(null);

  const canvasCommands = useCanvasCommands(project.id);
  const { fontScale } = useCanvasFontScale();
  const [highlightLinks, setHighlightLinks] = useState(loadHighlightLinks);
  const [hoveredFieldId, setHoveredFieldId] = useState<string | null>(null);
  const [hoveredTableId, setHoveredTableId] = useState<string | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [dbmlScrollRequest, setDbmlScrollRequest] = useState<{ tableName: string; requestId: number } | null>(null);
  const goToDbml = useCallback((tableName: string) => {
    setDbmlOpen(true);
    setDbmlScrollRequest((prev) => ({ tableName, requestId: (prev?.requestId ?? 0) + 1 }));
  }, []);

  /**
   * The canvas selection, held in a ref rather than passed as a dependency:
   * commands read it at the moment they run, and re-creating `runCanvasCommand`
   * on every selection change would re-render the whole canvas toolbar.
   */
  const selectedTableIdsRef = useRef<string[]>([]);

  /** Transient canvas status line. The timer is tracked so a second message replaces the first instead of being wiped by the first one's expiry. */
  const pluginMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((message: string) => {
    if (pluginMessageTimerRef.current) clearTimeout(pluginMessageTimerRef.current);
    setPluginMessage(message);
    pluginMessageTimerRef.current = setTimeout(() => setPluginMessage(null), PLUGIN_MESSAGE_MS);
  }, []);
  useEffect(
    () => () => {
      if (pluginMessageTimerRef.current) clearTimeout(pluginMessageTimerRef.current);
    },
    [],
  );

  /**
   * Runs a plugin canvas command and writes back whatever project it returns.
   * `writeProjectToDoc` diffs entity by entity, so a command that only renames
   * one table produces exactly one Yjs update — and the change lands in every
   * collaborator's canvas through the normal sync path.
   */
  const runCanvasCommand = useCallback(
    async (command: (typeof canvasCommands)[number]) => {
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

  const handleHighlightLinksChange = (val: boolean) => {
    setHighlightLinks(val);
    saveHighlightLinks(val);
  };

  // Populated by CanvasArea (inside the ReactFlowProvider) so ExportDialog
  // (outside it) can still trigger a canvas screenshot.
  const canvasExportRef = useRef<CanvasExportHandle | null>(null);
  const captureCanvasImage = useCallback(
    (format: "png" | "svg") =>
      canvasExportRef.current?.capture(format) ?? Promise.reject(new Error(t("editor.canvasNotReady"))),
    [t],
  );

  const cursorNodes = useCursorNodes(remoteAwareness);

  // Fields that are some ref's endpoint for a given table — shown outside compact detail level even if not PK.
  const refFieldIdsByTable = useMemo(() => {
    const map = new Map<string, Set<string>>();
    if (!liveProject) return map;
    for (const table of liveProject.tables) map.set(table.id, new Set());
    for (const ref of liveProject.refs) {
      map.get(ref.from.tableId)?.add(ref.from.fieldId);
      map.get(ref.to.tableId)?.add(ref.to.fieldId);
    }
    return map;
  }, [liveProject]);

  const palette = liveProject?.paletteColors ?? DEFAULT_PALETTE;
  const onPaletteChange = useCallback(
    (next: string[]) => {
      if (doc) getMetaMap(doc).set("paletteColors", next);
    },
    [doc],
  );

  const { nodes, onNodesChange } = useCanvasNodes(
    liveProject,
    doc,
    refFieldIdsByTable,
    user,
    highlightLinks,
    goToDbml,
    setHoveredFieldId,
    setHoveredTableId,
    selectedFieldId,
    setSelectedFieldId,
    canWrite,
  );

  const selectedTableIds = useMemo(
    () => nodes.filter((n) => n.type === "table" && n.selected).map((n) => n.id),
    [nodes],
  );
  useEffect(() => {
    selectedTableIdsRef.current = selectedTableIds;
  }, [selectedTableIds]);

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
  const edges = useCanvasEdges(
    liveProject,
    doc,
    nodes,
    highlightLinks,
    hoveredFieldId,
    hoveredTableId,
    selectedFieldId,
    selectedEdgeId,
    setSelectedEdgeId,
    palette,
    onPaletteChange,
    canWrite,
  );

  const {
    addTable,
    addZone,
    addStickyNote,
    addEnum,
    groupSelectedTables,
    setAllDetailLevels,
    activeDetailLevel,
    autoLayout,
    setTablesColor,
    duplicateSelected,
    onEdgesDelete,
    onConnect,
  } = useProjectMutations(liveProject, writeDoc, nodes);

  useEditorKeyboardShortcuts(canWrite ? undoManager : null, duplicateSelected, canWrite);

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      <ProjectToolbar
        projectName={project.name}
        viewOnly={!canWrite}
        connection={connection}
        synced={Boolean(liveProject)}
        onBack={props.onBack}
        onUndo={() => undoManager?.undo()}
        onRedo={() => undoManager?.redo()}
        onAutoLayout={autoLayout}
        onShowImport={() => setShowImport(true)}
        onShowExport={() => setShowExport(true)}
        onShowHistory={() => setShowHistory(true)}
        onOpenSettings={() => setShowSettings(true)}
        localUser={user}
        localColor={hashColor(user)}
        remoteAwareness={remoteAwareness}
      />
      {showSettings && (
        <SettingsModal
          session={session}
          onClose={() => setShowSettings(false)}
          onDisplayNameChange={props.onDisplayNameChange}
          onLogout={props.onLogout}
        />
      )}

      <div className="relative flex min-h-0 min-w-0 flex-1">
        {dbmlOpen && liveProject ? (
          <DbmlPanel
            project={liveProject}
            projectId={project.id}
            readOnly={!canWrite}
            onClose={() => setDbmlOpen(false)}
            scrollToTable={dbmlScrollRequest}
          />
        ) : (
          <button
            className="absolute left-2 top-2 z-[5] flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-sm border border-border bg-surface-raised p-0 text-text-muted shadow-sm hover:bg-surface-hover hover:text-text"
            onClick={() => setDbmlOpen(true)}
            data-tooltip={t("editor.showDbmlEditor")}
            data-tooltip-pos="bottom"
          >
            <ChevronRightIcon size={15} />
          </button>
        )}
        <ReactFlowProvider>
          <CanvasArea
            nodes={nodes}
            cursorNodes={cursorNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesDelete={onEdgesDelete}
            onConnect={onConnect}
            awareness={awareness}
            onAddTable={addTable}
            onAddZone={addZone}
            onAddNote={addStickyNote}
            onAddEnum={addEnum}
            onGroupTables={groupSelectedTables}
            onSetTablesColor={setTablesColor}
            palette={palette}
            fontScale={fontScale}
            activeDetailLevel={activeDetailLevel}
            onSetDetailLevel={setAllDetailLevels}
            highlightLinks={highlightLinks}
            onHighlightLinksChange={handleHighlightLinksChange}
            projectId={project.id}
            viewportUserId={session.id}
            exportRef={canvasExportRef}
            canvasCommands={canvasCommands}
            onRunCanvasCommand={runCanvasCommand}
            onOpenPlugins={() => setShowPlugins(true)}
            statusMessage={pluginMessage}
            selectedEdgeId={selectedEdgeId}
            onSelectEdge={setSelectedEdgeId}
            onClearFieldSelection={() => {
              setSelectedFieldId(null);
              setSelectedEdgeId(null);
            }}
            canWrite={canWrite}
          />
        </ReactFlowProvider>
      </div>
      <Suspense fallback={null}>
        {showImport && canWrite && <ImportDialog projectId={project.id} onClose={() => setShowImport(false)} />}
        {showExport && liveProject && (
          <ExportDialog
            projectId={project.id}
            projectName={project.name}
            project={liveProject}
            captureCanvasImage={captureCanvasImage}
            onClose={() => setShowExport(false)}
          />
        )}
        {showHistory && liveProject && (
          <HistoryPanel projectId={project.id} currentProject={liveProject} onClose={() => setShowHistory(false)} />
        )}
        {showPlugins && <PluginManagerDialog onClose={() => setShowPlugins(false)} />}
      </Suspense>
    </div>
  );
}
