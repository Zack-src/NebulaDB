import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { getMetaMap, writeProjectToDoc, type DatabaseConnectionSummary, type Project } from "@athanordb/shared";
import { listProjectConnections } from "@/services/connectionsApi";
import { useProjectDoc } from "@/features/collaboration/useProjectDoc";
import { useAwarenessStates } from "@/features/collaboration/useAwarenessStates";
import { useRemoteSelections } from "@/features/collaboration/useRemoteSelections";
import { hashColor } from "@/features/collaboration/awarenessColor";
import { CanvasArea } from "@/features/editor/canvas/CanvasArea";
import { ChevronRightIcon } from "@/components/icons/Icons";
import { DEFAULT_PALETTE } from "@/components/inputs/ColorSwatchPicker";
import { loadHighlightLinks, saveHighlightLinks } from "@/utils/preferences";
import type { CanvasExportHandle, CanvasNavigateHandle, ProjectSummary } from "@/types/index";
import { useCanvasNodes } from "@/features/editor/hooks/useCanvasNodes";
import { useCanvasEdges } from "@/features/editor/hooks/useCanvasEdges";
import { useCanvasFontScale } from "@/features/editor/hooks/useCanvasFontScale";
import { useProjectMutations } from "@/features/editor/hooks/useProjectMutations";
import { useEditorKeyboardShortcuts } from "@/features/editor/hooks/useEditorKeyboardShortcuts";
import { ProjectToolbar } from "@/features/editor/ProjectToolbar";
import { useTranslation } from "@/i18n/useTranslation";
import { useCanvasCommands } from "@/features/plugins/usePlugins";
import { matchShortcut } from "@/features/plugins/shortcuts";
import type { CanvasCommandResult } from "@/features/plugins/types";
import { AUTO_LAYOUT_ID, GROUP_TABLES_ID } from "@/features/plugins/builtins/coreCanvas";
import { McdCanvas } from "@/features/editor/mcd/McdCanvas";
import type { EditorViewMode } from "@/features/editor/mcd/ViewModeToggle";

import DbmlPanel from "@/features/editor/dbml/DbmlPanel";
const ImportDialog = lazy(() => import("@/features/editor/io/ImportDialog"));
const ExportDialog = lazy(() => import("@/features/editor/io/ExportDialog"));
const HistoryPanel = lazy(() => import("@/features/editor/history/HistoryPanel"));
const PluginManagerDialog = lazy(() => import("@/features/plugins/PluginManagerDialog"));
const ConnectionManagerModal = lazy(() =>
  import("@/features/connections/ConnectionManagerModal").then((m) => ({ default: m.ConnectionManagerModal })),
);
const DeploymentModal = lazy(() =>
  import("@/features/connections/DeploymentModal").then((m) => ({ default: m.DeploymentModal })),
);

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
  const remoteSelections = useRemoteSelections(awareness);
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [dbmlOpen, setDbmlOpen] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showPlugins, setShowPlugins] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showConnections, setShowConnections] = useState(false);
  const [showDeployment, setShowDeployment] = useState(false);
  const [viewMode, setViewMode] = useState<EditorViewMode>("mld");
  const [activeConnection, setActiveConnection] = useState<DatabaseConnectionSummary | null>(null);
  const [pluginMessage, setPluginMessage] = useState<string | null>(null);

  useEffect(() => {
    listProjectConnections(project.id)
      .then((list) => {
        if (list.length > 0) setActiveConnection(list[0]);
      })
      .catch(() => {});
  }, [project.id]);

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

  // Same "populated by CanvasArea, called from outside its ReactFlowProvider"
  // shape as the export handle above — this one drives the DBML editor's
  // double-click-to-canvas navigation instead of a screenshot.
  const canvasNavigateRef = useRef<CanvasNavigateHandle | null>(null);
  const onNavigateToCanvas = useCallback(
    (target: { tableName: string; fieldName?: string }) => {
      const table = liveProject?.tables.find((t) => t.name.toLowerCase() === target.tableName.toLowerCase());
      if (!table) return;
      canvasNavigateRef.current?.goToTable(table.id);
      const field = target.fieldName
        ? table.fields.find((f) => f.name.toLowerCase() === target.fieldName!.toLowerCase())
        : undefined;
      setSelectedFieldId(field?.id ?? null);
    },
    [liveProject],
  );

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
    setAllDetailLevels,
    activeDetailLevel,
    setTablesColor,
    duplicateSelected,
    onEdgesDelete,
    onConnect,
  } = useProjectMutations(liveProject, writeDoc, nodes);

  // Auto-layout and table-grouping are now the `athanordb.core-canvas`
  // plugin's `auto-layout`/`group-tables` canvasCommands (see coreCanvas.ts)
  // — these buttons just run them through the same `runCanvasCommand` path
  // every other canvas command uses, rather than calling a bespoke doc
  // mutation. If the plugin providing one is disabled, its button quietly
  // does nothing, same as any other canvas command would.
  const runCanvasCommandById = useCallback(
    (id: string) => {
      const command = canvasCommands.find((c) => c.contribution.id === id);
      if (command) void runCanvasCommand(command);
    },
    [canvasCommands, runCanvasCommand],
  );
  const onAutoLayout = useCallback(() => runCanvasCommandById(AUTO_LAYOUT_ID), [runCanvasCommandById]);
  const onGroupTables = useCallback(() => runCanvasCommandById(GROUP_TABLES_ID), [runCanvasCommandById]);

  // Inert while viewing the MCD: nothing dragged there is ever written to
  // the project, so routing Ctrl+Z through the real Yjs history would either
  // no-op confusingly or undo an unrelated MLD edit. `McdCanvas` owns its
  // own local undo/redo for node dragging instead.
  useEditorKeyboardShortcuts(
    canWrite && viewMode === "mld" ? undoManager : null,
    duplicateSelected,
    canWrite && viewMode === "mld",
  );

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
        onAutoLayout={onAutoLayout}
        onShowImport={() => setShowImport(true)}
        onShowExport={() => setShowExport(true)}
        onShowHistory={() => setShowHistory(true)}
        onShowConnections={() => setShowConnections(true)}
        onShowDeploy={() => setShowDeployment(true)}
        isProjectAdmin={project.permission === "administrator"}
        connectedDbName={activeConnection?.name}
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
            onNavigateToCanvas={onNavigateToCanvas}
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
          {/* `key={viewMode}` both drives the remount the ternary already
              causes (a fresh mount each switch, never a diff) and re-triggers
              this entrance animation every time — Figma's dev-mode toggle is
              the reference: a quick fade+scale so the switch reads as a mode
              change instead of a jump cut. */}
          <div key={viewMode} className="flex min-h-0 min-w-0 flex-1 animate-view-switch-in">
            {viewMode === "mld" ? (
              <CanvasArea
                nodes={nodes}
                remoteSelections={remoteSelections}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesDelete={onEdgesDelete}
                onConnect={onConnect}
                awareness={awareness}
                onAddTable={addTable}
                onAddZone={addZone}
                onAddNote={addStickyNote}
                onAddEnum={addEnum}
                onGroupTables={onGroupTables}
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
                navigateRef={canvasNavigateRef}
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
                viewMode={viewMode}
                onSetViewMode={setViewMode}
              />
            ) : (
              liveProject && (
                <McdCanvas
                  project={liveProject}
                  projectId={project.id}
                  viewportUserId={session.id}
                  viewMode={viewMode}
                  onSetViewMode={setViewMode}
                />
              )
            )}
          </div>
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
        {showConnections && (
          <ConnectionManagerModal
            projectId={project.id}
            onClose={() => setShowConnections(false)}
            activeConnectionId={activeConnection?.id}
            onSelectActiveConnection={(conn) => setActiveConnection(conn)}
          />
        )}
        {showDeployment && (
          <DeploymentModal
            projectId={project.id}
            onClose={() => setShowDeployment(false)}
            initialConnectionId={activeConnection?.id}
            onOpenConnectionManager={() => {
              setShowDeployment(false);
              setShowConnections(true);
            }}
          />
        )}
      </Suspense>
    </div>
  );
}
