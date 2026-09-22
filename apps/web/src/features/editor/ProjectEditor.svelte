<script lang="ts" module>
  /**
   * Above this many tables, every table renders at "compact" — a display
   * override only, never written to the doc (`liveProject` itself, and
   * everything derived from it, keeps each table's real setting; only
   * `renderProject`, fed to the two rendering passes, is touched). "Full"
   * detail means every field row plus its four handles, per table — measured
   * at 500 tables it was ~66% of a selection-drag's wall-clock time spent in
   * the flow's own hit-testing and the browser's layout/paint for that much
   * DOM, collapsing to a fraction of that at "compact". The threshold is a
   * guess at "more than a screenful even zoomed out", not a measured knee —
   * revisit with the bench harness if it turns out wrong in either direction.
   */
  const RENDER_LOD_TABLE_THRESHOLD = 150;

  function sameIds(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { SvelteFlowProvider } from "@xyflow/svelte";
  import { getMetaMap, type DatabaseConnectionSummary, type Project, type Table } from "@athanordb/shared";
  import { validateProject, type ValidationIssue } from "@athanordb/dbml-engine";
  import { listProjectConnections } from "@/services/connectionsApi";
  import { useProjectDoc } from "@/features/collaboration/projectDoc.svelte";
  import { useAwarenessStates, useRemoteSelections } from "@/features/collaboration/awarenessStates.svelte";
  import { hashColor } from "@/features/collaboration/awarenessColor";
  import CanvasArea from "@/features/editor/canvas/CanvasArea.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { ChevronRightIcon } from "@/components/icons/Icons";
  import { DEFAULT_PALETTE } from "@/components/inputs/colorSwatches";
  import {
    loadHighlightLinks,
    loadShowValidationIssues,
    saveHighlightLinks,
    saveShowValidationIssues,
  } from "@/utils/preferences";
  import type { CanvasExportHandle, CanvasNavigateHandle, ProjectSummary, Session } from "@/types/index";
  import { CanvasNodesState } from "@/features/editor/hooks/useCanvasNodes/canvasNodes.svelte";
  import { CanvasEdgesState } from "@/features/editor/hooks/canvasEdges.svelte";
  import { useCanvasFontScale } from "@/features/editor/hooks/canvasFontScale.svelte";
  import { activeDetailLevelOf, createProjectMutations } from "@/features/editor/hooks/projectMutations";
  import { useEditorKeyboardShortcuts } from "@/features/editor/hooks/editorKeyboardShortcuts.svelte";
  import { useCanvasCommandRunner } from "@/features/editor/hooks/canvasCommandRunner.svelte";
  import ProjectToolbar from "@/features/editor/ProjectToolbar.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { useCanvasCommands } from "@/features/plugins/plugins.svelte";
  import McdCanvas from "@/features/editor/mcd/McdCanvas.svelte";
  import type { EditorViewMode } from "@/features/editor/mcd/ViewModeToggle.svelte";
  import DbmlPanel from "@/features/editor/dbml/DbmlPanel.svelte";
  import SettingsModal from "@/features/settings/SettingsModal.svelte";

  let props: {
    project: ProjectSummary;
    session: Session;
    onDisplayNameChange: (name: string) => Promise<void>;
    onLogout: () => void;
    onBack: () => void;
  } = $props();

  const { t } = useTranslation();
  const project = $derived(props.project);
  const user = $derived(props.session.displayName);
  /**
   * A `view` grant is enforced by the server, which simply drops the Yjs
   * updates it receives from a read-only connection — silently, with no
   * rejection frame. So without a client-side gate the whole editor stayed
   * live: tables dragged, DBML typed, buttons worked, and every change
   * vanished on reload with nothing ever having said no. Everything that can
   * write to the document is gated on this.
   */
  const canWrite = $derived(project.permission !== "view");
  const docHandle = useProjectDoc(
    () => project.id,
    () => project.name,
    () => user,
  );
  const liveProject = $derived(docHandle.project);
  const doc = $derived(docHandle.doc);
  /** Handed to the write paths in place of `doc`: every mutator already early-returns on a null doc, so one substitution closes all of them at once. */
  const writeDoc = $derived(canWrite ? doc : null);
  const remoteAwareness = useAwarenessStates(() => docHandle.awareness);
  const remoteSelections = useRemoteSelections(() => docHandle.awareness);
  let showImport = $state(false);
  let showExport = $state(false);
  let showConvertTypes = $state(false);
  let dbmlOpen = $state(true);
  let showHistory = $state(false);
  let showPlugins = $state(false);
  let showSettings = $state(false);
  let showDeployment = $state(false);
  let viewMode = $state<EditorViewMode>("mld");
  // Connections themselves are managed from the admin console now — this
  // just needs to know which one to preselect when Deploy opens.
  let activeConnection = $state.raw<DatabaseConnectionSummary | null>(null);

  $effect(() => {
    listProjectConnections(project.id)
      .then((list) => {
        if (list.length > 0) activeConnection = list[0];
      })
      .catch(() => {});
  });

  const canvasCommands = useCanvasCommands(() => project.id);
  const fontScale = useCanvasFontScale();
  let highlightLinks = $state(loadHighlightLinks());
  let showValidationIssues = $state(loadShowValidationIssues());
  let hoveredFieldId = $state<string | null>(null);
  let hoveredTableId = $state<string | null>(null);
  let selectedFieldId = $state<string | null>(null);
  let selectedEdgeId = $state<string | null>(null);
  let dbmlScrollRequest = $state.raw<{ tableName: string; requestId: number } | null>(null);

  // Stable identities: the per-table node cache keys on the callback bundle,
  // so these must never be re-created.
  const goToDbml = (tableName: string) => {
    dbmlOpen = true;
    dbmlScrollRequest = { tableName, requestId: (dbmlScrollRequest?.requestId ?? 0) + 1 };
  };
  const setHoveredFieldId = (id: string | null) => (hoveredFieldId = id);
  const setHoveredTableId = (id: string | null) => (hoveredTableId = id);
  const setSelectedFieldId = (id: string | null) => (selectedFieldId = id);
  const setSelectedEdgeId = (id: string | null) => (selectedEdgeId = id);
  const openPlugins = () => (showPlugins = true);
  const clearFieldSelection = () => {
    selectedFieldId = null;
    selectedEdgeId = null;
  };

  function handleHighlightLinksChange(value: boolean) {
    highlightLinks = value;
    saveHighlightLinks(value);
  }

  function handleShowValidationIssuesChange(value: boolean) {
    showValidationIssues = value;
    saveShowValidationIssues(value);
  }

  // Recomputed on every doc update, like `refFieldIdsByTable` below — cheap
  // (a handful of O(tables+refs) passes) next to the Yjs->Project rebuild that
  // already happens on every change.
  const validationIssues = $derived(liveProject ? validateProject(liveProject) : []);
  const issuesByTable = $derived.by(() => {
    const map = new Map<string, ValidationIssue[]>();
    for (const issue of validationIssues) {
      if (!issue.tableId) continue;
      const list = map.get(issue.tableId);
      if (list) list.push(issue);
      else map.set(issue.tableId, [issue]);
    }
    return map;
  });
  const issuesByRef = $derived.by(() => {
    const map = new Map<string, ValidationIssue[]>();
    for (const issue of validationIssues) {
      if (!issue.refId) continue;
      const list = map.get(issue.refId);
      if (list) list.push(issue);
      else map.set(issue.refId, [issue]);
    }
    return map;
  });

  // Populated by CanvasArea so ExportDialog (outside the canvas) can still
  // trigger a canvas screenshot.
  const canvasExportRef: { current: CanvasExportHandle | null } = { current: null };
  const captureCanvasImage = (format: "png" | "svg") =>
    canvasExportRef.current?.capture(format) ?? Promise.reject(new Error(t("editor.canvasNotReady")));

  // Same shape as the export handle above — this one drives the DBML editor's
  // double-click-to-canvas navigation instead of a screenshot.
  const canvasNavigateRef: { current: CanvasNavigateHandle | null } = { current: null };
  function onNavigateToCanvas(target: { tableName: string; fieldName?: string }) {
    const table = liveProject?.tables.find((tbl) => tbl.name.toLowerCase() === target.tableName.toLowerCase());
    if (!table) return;
    canvasNavigateRef.current?.goToTable(table.id);
    const field = target.fieldName
      ? table.fields.find((f) => f.name.toLowerCase() === target.fieldName!.toLowerCase())
      : undefined;
    selectedFieldId = field?.id ?? null;
  }

  // Fields that are some ref's endpoint for a given table — shown outside
  // compact detail level even if not PK. A fresh Map/Set per project change;
  // the node cache compares the per-table Sets by content, not reference.
  const refFieldIdsByTable = $derived.by(() => {
    const map = new Map<string, Set<string>>();
    if (!liveProject) return map;
    for (const table of liveProject.tables) map.set(table.id, new Set());
    for (const ref of liveProject.refs) {
      map.get(ref.from.tableId)?.add(ref.from.fieldId);
      map.get(ref.to.tableId)?.add(ref.to.fieldId);
    }
    return map;
  });

  const palette = $derived(liveProject?.paletteColors ?? DEFAULT_PALETTE);
  const onPaletteChange = (next: string[]) => {
    if (doc) getMetaMap(doc).set("paletteColors", next);
  };

  // Keyed by the real (Yjs-backed) table object, which `readProjectFromDoc`
  // already keeps reference-stable per id across doc updates that don't touch
  // that particular table. Without this cache, minting a compact copy fresh on
  // every recompute handed every *unchanged* table a new identity too —
  // defeating the per-table node cache's whole point.
  const compactOverrideCache = new WeakMap<Table, Table>();
  const renderProject = $derived.by((): Project | null => {
    if (!liveProject || liveProject.tables.length <= RENDER_LOD_TABLE_THRESHOLD) return liveProject;
    return {
      ...liveProject,
      tables: liveProject.tables.map((tbl) => {
        if (tbl.detailLevel === "compact") return tbl;
        let overridden = compactOverrideCache.get(tbl);
        if (!overridden) {
          overridden = { ...tbl, detailLevel: "compact" as const };
          compactOverrideCache.set(tbl, overridden);
        }
        return overridden;
      }),
    };
  });

  const nodesState = new CanvasNodesState({
    liveProject: () => renderProject,
    doc: () => doc,
    refFieldIdsByTable: () => refFieldIdsByTable,
    user: () => user,
    onGoToDbml: goToDbml,
    onFieldHoverChange: setHoveredFieldId,
    onTableHoverChange: setHoveredTableId,
    selectedFieldId: () => selectedFieldId,
    onSelectField: setSelectedFieldId,
    canWrite: () => canWrite,
    issuesByTable: () => issuesByTable,
    showValidationIssues: () => showValidationIssues,
  });

  // Same array back while the selected set is unchanged — a drag frame
  // replaces `nodes` without changing which tables are selected, and nothing
  // keyed on the selection should hear about it.
  let lastSelectedTableIds: string[] = [];
  const selectedTableIds = $derived.by(() => {
    const next = nodesState.nodes.filter((n) => n.type === "table" && n.selected).map((n) => n.id);
    if (sameIds(next, lastSelectedTableIds)) return lastSelectedTableIds;
    lastSelectedTableIds = next;
    return next;
  });

  const commandRunner = useCanvasCommandRunner({
    liveProject: () => liveProject,
    doc: () => doc,
    canWrite: () => canWrite,
    canvasCommands: () => canvasCommands.list,
    selectedTableIds: () => untrack(() => selectedTableIds),
  });

  const edgesState = new CanvasEdgesState({
    liveProject: () => renderProject,
    doc: () => doc,
    nodes: () => nodesState.nodes,
    highlightLinks: () => highlightLinks,
    hoveredFieldId: () => hoveredFieldId,
    hoveredTableId: () => hoveredTableId,
    selectedFieldId: () => selectedFieldId,
    selectedEdgeId: () => selectedEdgeId,
    onSelectEdge: setSelectedEdgeId,
    palette: () => palette,
    onPaletteChange,
    canWrite: () => canWrite,
    dragging: () => nodesState.dragging,
    issuesByRef: () => issuesByRef,
    showValidationIssues: () => showValidationIssues,
    selectedTableIds: () => selectedTableIds,
  });

  const mutations = createProjectMutations(
    () => liveProject,
    () => writeDoc,
    () => nodesState.nodes,
  );
  const activeDetailLevel = $derived(activeDetailLevelOf(liveProject));

  // Inert while viewing the MCD: nothing dragged there is ever written to the
  // project, so routing Ctrl+Z through the real Yjs history would either no-op
  // confusingly or undo an unrelated MLD edit. `McdCanvas` owns its own local
  // undo/redo for node dragging instead.
  useEditorKeyboardShortcuts(
    () => docHandle.undoManager,
    mutations.duplicateSelected,
    () => canWrite && viewMode === "mld",
  );
</script>

<div style="width: 100%; height: 100%; display: flex; flex-direction: column">
  <ProjectToolbar
    projectName={project.name}
    viewOnly={!canWrite}
    connection={docHandle.connection}
    synced={Boolean(liveProject)}
    onBack={props.onBack}
    onUndo={() => docHandle.undoManager?.undo()}
    onRedo={() => docHandle.undoManager?.redo()}
    onAutoLayout={commandRunner.onAutoLayout}
    onShowImport={() => (showImport = true)}
    onShowExport={() => (showExport = true)}
    onShowConvertTypes={canWrite ? () => (showConvertTypes = true) : undefined}
    onShowHistory={() => (showHistory = true)}
    onShowDeploy={() => (showDeployment = true)}
    isProjectAdmin={project.permission === "administrator"}
    onOpenSettings={() => (showSettings = true)}
    localUser={user}
    localColor={hashColor(user)}
    remoteAwareness={remoteAwareness.states}
  />
  {#if showSettings}
    <SettingsModal
      session={props.session}
      onClose={() => (showSettings = false)}
      onDisplayNameChange={props.onDisplayNameChange}
      onLogout={props.onLogout}
    />
  {/if}

  <div class="relative flex min-h-0 min-w-0 flex-1">
    {#if dbmlOpen && liveProject}
      <DbmlPanel
        project={liveProject}
        projectId={project.id}
        readOnly={!canWrite}
        onClose={() => (dbmlOpen = false)}
        scrollToTable={dbmlScrollRequest}
        {onNavigateToCanvas}
      />
    {:else}
      <button
        class="absolute left-2 top-2 z-[5] flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-sm border border-border bg-surface-raised p-0 text-text-muted shadow-sm hover:bg-surface-hover hover:text-text"
        onclick={() => (dbmlOpen = true)}
        data-tooltip={t("editor.showDbmlEditor")}
        data-tooltip-pos="bottom"
        aria-label={t("editor.showDbmlEditor")}
      >
        <Icon icon={ChevronRightIcon} size={15} />
      </button>
    {/if}
    <SvelteFlowProvider>
      <!-- Keyed on the view mode: a fresh mount each switch (never a diff),
           which also replays this entrance animation every time — a quick
           fade+scale so the switch reads as a mode change instead of a jump cut. -->
      {#key viewMode}
        <div class="flex min-h-0 min-w-0 flex-1 animate-view-switch-in">
          {#if viewMode === "mld"}
            <CanvasArea
              {nodesState}
              edges={edgesState.edges}
              {selectedTableIds}
              remoteSelections={remoteSelections.selections}
              onDeleteEdges={mutations.deleteEdges}
              onConnect={mutations.onConnect}
              awareness={docHandle.awareness}
              onAddTable={mutations.addTable}
              onAddZone={mutations.addZone}
              onAddNote={mutations.addStickyNote}
              onAddEnum={mutations.addEnum}
              onGroupTables={commandRunner.onGroupTables}
              onSetTablesColor={mutations.setTablesColor}
              {palette}
              fontScale={fontScale.fontScale}
              {activeDetailLevel}
              onSetDetailLevel={mutations.setAllDetailLevels}
              {highlightLinks}
              onHighlightLinksChange={handleHighlightLinksChange}
              {showValidationIssues}
              onShowValidationIssuesChange={handleShowValidationIssuesChange}
              projectId={project.id}
              viewportUserId={props.session.id}
              exportRef={canvasExportRef}
              navigateRef={canvasNavigateRef}
              canvasCommands={canvasCommands.list}
              onRunCanvasCommand={commandRunner.runCanvasCommand}
              onOpenPlugins={openPlugins}
              statusMessage={commandRunner.pluginMessage}
              {selectedEdgeId}
              onSelectEdge={setSelectedEdgeId}
              onClearFieldSelection={clearFieldSelection}
              {canWrite}
              {viewMode}
              onSetViewMode={(mode) => (viewMode = mode)}
            />
          {:else if liveProject}
            <McdCanvas
              project={liveProject}
              projectId={project.id}
              viewportUserId={props.session.id}
              {viewMode}
              onSetViewMode={(mode) => (viewMode = mode)}
            />
          {/if}
        </div>
      {/key}
    </SvelteFlowProvider>
  </div>

  <!-- Dialogs are code-split: none of them is in the chunk a project view loads. -->
  {#if showImport && canWrite}
    {#await import("@/features/editor/io/ImportDialog.svelte") then { default: ImportDialog }}
      <ImportDialog projectId={project.id} onClose={() => (showImport = false)} />
    {/await}
  {/if}
  {#if showExport && liveProject}
    {#await import("@/features/editor/io/ExportDialog.svelte") then { default: ExportDialog }}
      <ExportDialog
        projectId={project.id}
        projectName={project.name}
        project={liveProject}
        {captureCanvasImage}
        onClose={() => (showExport = false)}
      />
    {/await}
  {/if}
  {#if showConvertTypes && liveProject && canWrite}
    {#await import("@/features/editor/ConvertTypesModal.svelte") then { default: ConvertTypesModal }}
      <ConvertTypesModal
        project={liveProject}
        onApply={mutations.convertFieldTypes}
        onClose={() => (showConvertTypes = false)}
      />
    {/await}
  {/if}
  {#if showHistory && liveProject}
    {#await import("@/features/editor/history/HistoryPanel.svelte") then { default: HistoryPanel }}
      <HistoryPanel projectId={project.id} currentProject={liveProject} onClose={() => (showHistory = false)} />
    {/await}
  {/if}
  {#if showPlugins}
    {#await import("@/features/plugins/PluginManagerDialog.svelte") then { default: PluginManagerDialog }}
      <PluginManagerDialog onClose={() => (showPlugins = false)} />
    {/await}
  {/if}
  {#if showDeployment}
    {#await import("@/features/connections/DeploymentModal.svelte") then { default: DeploymentModal }}
      <DeploymentModal
        projectId={project.id}
        onClose={() => (showDeployment = false)}
        initialConnectionId={activeConnection?.id}
      />
    {/await}
  {/if}
  <!-- Diagnostics overlay for editor stutter/freezes — hidden until Ctrl+Shift+P, see PerfHud. -->
  {#await import("@/components/dev/PerfHud.svelte") then { default: PerfHud }}
    <PerfHud />
  {/await}
</div>
