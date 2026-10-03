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
  import {
    getMetaMap,
    type DatabaseConnectionSummary,
    type Project,
    type ProjectDriftEntry,
    type ServerNotice,
    type Table,
  } from "@athanordb/shared";
  import { toast } from "@/components/ui/toast.svelte";
  import { TableLocksState } from "@/features/editor/locks/tableLocks.svelte";
  import { SeedsState } from "@/features/editor/seeds/seeds.svelte";
  import Splitter from "@/components/ui/Splitter.svelte";
  import { previewRowsStatement } from "@/features/sql/previewStatement";
  import { readBoolean, readNumberInRange, writeBoolean, writeString } from "@/utils/storage";
  import { diffProjects, validateProject, type ValidationIssue } from "@athanordb/dbml-engine";
  import type { RevisionSummary } from "@/services/projectsApi";
  import HistoryPreviewBanner from "@/features/editor/history/HistoryPreviewBanner.svelte";
  import type { HistoryDiffStatus } from "@/features/editor/hooks/useCanvasNodes/canvasNodes.svelte";
  import { fetchProjectDrift, listProjectConnections } from "@/services/connectionsApi";
  import DriftBanner from "@/features/editor/drift/DriftBanner.svelte";
  import type { TabItem } from "@/components/ui/Tabs.svelte";
  import { ClockIcon, CodeIcon, DatabaseIcon, SparklesIcon } from "@/components/icons/Icons";
  import type { WorkspaceTab } from "@/features/projects/projectRouting.svelte";
  import WorkspaceBar from "@/features/workspace/WorkspaceBar.svelte";
  import { provideWorkspace } from "@/features/workspace/workspaceContext";
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
  import { useCanvasClipboard } from "@/features/editor/hooks/canvasClipboard.svelte";
  import { useFlashMessage } from "@/hooks/flashMessage.svelte";
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
    /** Table (and optionally column) to centre on once the document has loaded — from a cross-project search hit. */
    initialFocus?: { tableName: string; fieldName?: string } | null;
    /** The workspace tab the URL names. Optional: the perf harness mounts the editor with no router. */
    tab?: WorkspaceTab;
    onTabChange?: (tab: WorkspaceTab) => void;
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

  // Table locks: mirrored here so the editor does not offer what the server
  // would refuse. The server remains the one that enforces them.
  const tableLocks = new TableLocksState(() => project.id);
  let lockDialogTableId = $state<string | null>(null);
  const openLockDialog = (tableId: string) => (lockDialogTableId = tableId);
  // Tables' initial rows (seeds): mirrored for the canvas icon; the dialog edits them.
  const seeds = new SeedsState(() => project.id);
  let seedDialogTableId = $state<string | null>(null);
  const openSeedDialog = (tableId: string) => (seedDialogTableId = tableId);
  const tellLockedTablesKept = (tables: string[]) =>
    toast.warning(t("locks.keptToast", { tables: tables.join(", "), count: tables.length }));
  // Linked databases known to have been changed outside the schema — see `DriftBanner`.
  let drift = $state.raw<ProjectDriftEntry[]>([]);
  let differencesFor = $state<string | null>(null);
  const refreshDrift = () =>
    fetchProjectDrift(project.id)
      .then((entries) => (drift = entries.filter((entry) => entry.outOfSchemaAt)))
      // Offline or the perf harness: no banner is better than a broken editor.
      .catch(() => {});
  $effect(() => {
    void project.id;
    drift = [];
    void refreshDrift();
  });

  function handleServerNotice(notice: ServerNotice) {
    if (notice.type === "drift-changed") void refreshDrift();
    else if (notice.type === "locks-changed") void tableLocks.refresh();
    else if (notice.type === "seeds-changed") void seeds.refresh();
    else if (notice.type === "table-locked") {
      toast.warning(t("locks.revertedToast", { tables: notice.tables.join(", "), count: notice.tables.length }));
      // The local picture was evidently out of date — that is how the change got offered at all.
      void tableLocks.refresh();
    }
  }

  const docHandle = useProjectDoc(
    () => project.id,
    () => project.name,
    () => user,
    handleServerNotice,
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
  let showCompare = $state(false);
  let dbmlOpen = $state(true);
  let showPlugins = $state(false);
  let showSettings = $state(false);
  let showDeployment = $state(false);
  let viewMode = $state<EditorViewMode>("mld");
  // Connections themselves are managed from the admin console now — this
  // just needs to know which one to preselect when Deploy opens.
  let connections = $state.raw<DatabaseConnectionSummary[]>([]);
  let connectionId = $state<string | null>(null);
  const activeConnection = $derived(connections.find((connection) => connection.id === connectionId) ?? null);

  $effect(() => {
    listProjectConnections(project.id)
      .then((list) => {
        connections = list;
        if (!list.some((connection) => connection.id === connectionId)) connectionId = list[0]?.id ?? null;
      })
      .catch(() => {});
  });

  // ---- Workspace tabs --------------------------------------------------------
  // The schema editor is one section of the project among several. Which ones
  // are offered follows what the server would allow: the database console is
  // for instance administrators, deployments for the project's administrators.
  const isProjectAdmin = $derived(project.permission === "administrator");
  const workspaceTabs = $derived.by(() => {
    const list: TabItem<WorkspaceTab>[] = [{ id: "schema", label: t("workspace.tab.schema"), icon: CodeIcon }];
    if (props.session.isAdmin && connections.length > 0) {
      list.push({ id: "data", label: t("workspace.tab.data"), icon: DatabaseIcon });
    }
    if (isProjectAdmin) list.push({ id: "deployments", label: t("workspace.tab.deployments"), icon: SparklesIcon });
    list.push({ id: "history", label: t("workspace.tab.history"), icon: ClockIcon });
    return list;
  });
  // A tab named by the URL but not offered to this user (a shared link, a
  // permission that changed) quietly shows the schema instead of an empty page.
  let localTab = $state<WorkspaceTab>("schema");
  const requestedTab = $derived(props.tab ?? localTab);
  const tab = $derived(workspaceTabs.some((item) => item.id === requestedTab) ? requestedTab : "schema");
  const setTab = (next: WorkspaceTab) => {
    localTab = next;
    props.onTabChange?.(next);
  };

  // ---- History preview -------------------------------------------------------
  // "Aperçu sur le graphe" from the history tab: the schema tab with the tables
  // added or changed since that revision outlined. Recomputed against the live
  // project, so the outline follows edits made meanwhile.
  let historyPreview = $state.raw<{ revision: RevisionSummary; project: Project } | null>(null);
  /** The revision the history tab shows when it is opened again — the one last previewed. */
  let historyRevisionId = $state<string | null>(null);
  const historyPreviewDiff = $derived(
    historyPreview && liveProject ? diffProjects(historyPreview.project, liveProject) : null,
  );
  const historyDiffStatus = $derived.by((): ReadonlyMap<string, HistoryDiffStatus> | null => {
    if (!historyPreviewDiff) return null;
    const marks = new Map<string, HistoryDiffStatus>();
    for (const table of historyPreviewDiff.tables) {
      if (table.status !== "removed") marks.set(table.id, table.status);
    }
    return marks;
  });
  function previewRevision(revision: RevisionSummary, revisionProject: Project) {
    historyPreview = { revision, project: revisionProject };
    historyRevisionId = revision.id;
    viewMode = "mld";
    setTab("schema");
  }
  // Leaving the project ends the preview; so does a revision from another one.
  $effect(() => {
    void project.id;
    historyPreview = null;
    historyRevisionId = null;
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
  /** Returns whether the canvas actually found the table — false while it hasn't rendered its nodes yet. */
  function onNavigateToCanvas(target: { tableName: string; fieldName?: string }): boolean {
    const table = liveProject?.tables.find((tbl) => tbl.name.toLowerCase() === target.tableName.toLowerCase());
    if (!table) return false;
    const found = canvasNavigateRef.current?.goToTable(table.id) ?? false;
    const field = target.fieldName
      ? table.fields.find((f) => f.name.toLowerCase() === target.fieldName!.toLowerCase())
      : undefined;
    selectedFieldId = field?.id ?? null;
    return found;
  }

  // ---- SQL drawer under the schema -------------------------------------------
  // The console's SQL panel, within reach of the diagram. Offered to exactly
  // those the console is offered to; open / closed and height are remembered
  // per browser.
  const SQL_OPEN_KEY = "athanordb.sqlDrawer.open";
  const SQL_HEIGHT_KEY = "athanordb.sqlDrawer.height";
  const SQL_MIN_HEIGHT = 140;
  const SQL_MAX_HEIGHT = 640;
  const canUseSql = $derived(props.session.isAdmin && activeConnection !== null);
  let sqlOpen = $state(readBoolean(SQL_OPEN_KEY, false));
  let sqlHeight = $state(readNumberInRange(SQL_HEIGHT_KEY, SQL_MIN_HEIGHT, SQL_MAX_HEIGHT, 300));
  let sqlRequest = $state.raw<{ sql: string; token: number } | null>(null);
  const setSqlOpen = (open: boolean) => {
    sqlOpen = open;
    writeBoolean(SQL_OPEN_KEY, open);
  };
  // Stable identity: it is part of what the table node cache compares.
  const viewTableData = (table: Table) => {
    if (!activeConnection) return;
    setSqlOpen(true);
    sqlRequest = { sql: previewRowsStatement(activeConnection.engine, table), token: (sqlRequest?.token ?? 0) + 1 };
  };
  $effect(() => {
    if (!canUseSql || tab !== "schema") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "j") return;
      // Deliberately also while typing: it is how one leaves the SQL editor for the diagram and comes back.
      event.preventDefault();
      setSqlOpen(!sqlOpen);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // What the canvas should centre on as soon as it can: the table a search hit
  // or a link asked for when the project opened, or one requested later from
  // another tab (the console sending a structural change to the schema).
  let focusRequest = $state.raw<{ tableName: string; fieldName?: string } | null>(untrack(() => props.initialFocus) ?? null);
  provideWorkspace({
    openInSchema: (projectId, tableName, fieldName) => {
      if (projectId !== project.id) return false;
      setTab("schema");
      if (tableName) focusRequest = { tableName, fieldName };
      return true;
    },
  });

  // One-shot: centre on the requested table once it exists in the doc *and*
  // the canvas can navigate. Both arrive later than mount, independently:
  // `liveProject` is non-null (but empty) before the first sync lands, and the
  // canvas only reports ready after Svelte Flow's own initial fit. So this
  // re-arms on every doc change until the target shows up, retries per frame
  // until the canvas accepts the jump, and only then marks itself done.
  $effect(() => {
    const focus = focusRequest;
    const tables = liveProject?.tables;
    if (!focus || !tables || tab !== "schema") return;
    if (!tables.some((table) => table.name.toLowerCase() === focus.tableName.toLowerCase())) return;
    let attempts = 0;
    let frame = 0;
    const tryFocus = () => {
      if (canvasNavigateRef.current && onNavigateToCanvas(focus)) {
        focusRequest = null;
        return;
      }
      if (++attempts < 120) frame = requestAnimationFrame(tryFocus);
    };
    frame = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(frame);
  });

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
    locks: () => tableLocks.view,
    onManageLock: openLockDialog,
    seeds: () => seeds.byTable,
    onManageSeed: openSeedDialog,
    onLockedTablesKept: tellLockedTablesKept,
    viewData: () => (canUseSql ? viewTableData : null),
    historyDiff: () => (tab === "schema" ? historyDiffStatus : null),
  });
  const seedDialogTable = $derived(
    seedDialogTableId ? (liveProject?.tables.find((table) => table.id === seedDialogTableId) ?? null) : null,
  );
  /** A `full` lock freezes the rows as well as the shape, for whoever it binds. */
  const seedEditable = (tableId: string) =>
    canWrite &&
    !(tableLocks.view.byTable.get(tableId)?.level === "full" && tableLocks.view.frozen.has(tableId));
  const lockDialogTable = $derived(
    lockDialogTableId ? (liveProject?.tables.find((table) => table.id === lockDialogTableId) ?? null) : null,
  );

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
    // The canvas is not mounted on the other tabs: Ctrl+Z there must not undo an edit nobody is looking at.
    () => canWrite && viewMode === "mld" && tab === "schema",
  );

  // Copy / paste of tables through the system clipboard — see `tableClipboard.ts`.
  const clipboardStatus = useFlashMessage(3000);
  const clipboard = useCanvasClipboard({
    project: () => liveProject,
    selectedTableIds: () => selectedTableIds,
    canCopy: () => viewMode === "mld" && tab === "schema",
    canPaste: () => canWrite && viewMode === "mld" && tab === "schema",
    paste: mutations.pasteTables,
    onCopied: (count) => clipboardStatus.flash(t("canvas.tablesCopied", { count })),
    onPasted: (count) => clipboardStatus.flash(t("canvas.tablesPasted", { count })),
    onNothingToPaste: () => clipboardStatus.flash(t("canvas.nothingToPaste")),
  });
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
    onShowCompare={() => (showCompare = true)}
    onShowDeploy={() => (showDeployment = true)}
    {isProjectAdmin}
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

  <WorkspaceBar
    tabs={workspaceTabs}
    {tab}
    onTabChange={setTab}
    {connections}
    {connectionId}
    onConnectionChange={(id) => (connectionId = id)}
    {sqlOpen}
    onToggleSql={canUseSql && tab === "schema" ? () => setSqlOpen(!sqlOpen) : undefined}
  />
  {#each drift as entry (entry.connectionId)}
    <DriftBanner
      projectId={project.id}
      {entry}
      canManage={isProjectAdmin}
      onShowDifferences={(connectionId) => (differencesFor = connectionId)}
    />
  {/each}

  <!-- The other tabs replace the editor rather than cover it: an unmounted
       canvas has no keyboard shortcuts, clipboard handlers or selection to act
       on by accident. The document connection lives above, so nothing is lost. -->
  {#if tab === "data"}
    {#await import("@/features/workspace/DataTab.svelte") then { default: DataTab }}
      <DataTab {connectionId} />
    {/await}
  {:else if tab === "deployments"}
    {#await import("@/features/workspace/DeploymentsTab.svelte") then { default: DeploymentsTab }}
      <DeploymentsTab
        projectId={project.id}
        connection={activeConnection}
        canDeploy={canWrite}
        onDeploy={() => (showDeployment = true)}
        onShowDifferences={() => (differencesFor = connectionId)}
      />
    {/await}
  {:else if tab === "history" && liveProject}
    {#await import("@/features/editor/history/HistoryPanel.svelte") then { default: HistoryPanel }}
      <HistoryPanel
        projectId={project.id}
        currentProject={liveProject}
        currentUser={user}
        initialRevisionId={historyRevisionId}
        canRestore={canWrite}
        onPreview={previewRevision}
        onClose={() => {
          historyPreview = null;
          setTab("schema");
        }}
      />
    {/await}
  {:else}
  {#if historyPreview && historyPreviewDiff}
    <HistoryPreviewBanner
      projectId={project.id}
      revision={historyPreview.revision}
      diff={historyPreviewDiff}
      canRestore={canWrite}
      onBack={() => setTab("history")}
      onClose={() => (historyPreview = null)}
    />
  {/if}
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
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
              statusMessage={clipboardStatus.message ?? commandRunner.pluginMessage}
              onCopyTables={clipboard.copy}
              onPasteTables={clipboard.pasteAt}
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
  {#if sqlOpen && canUseSql && activeConnection}
    <Splitter
      bind:size={sqlHeight}
      min={SQL_MIN_HEIGHT}
      max={SQL_MAX_HEIGHT}
      edge="top"
      aria-label={t("workspace.sql.resize")}
      onCommit={(height) => writeString(SQL_HEIGHT_KEY, String(height))}
    />
    <div class="flex shrink-0 flex-col" style:height="{sqlHeight}px">
      {#await import("@/features/sql/EditorSqlDrawer.svelte") then { default: EditorSqlDrawer }}
        <!-- Keyed: the drawer and its history belong to one connection. -->
        {#key activeConnection.id}
          <EditorSqlDrawer connection={activeConnection} request={sqlRequest} onClose={() => setSqlOpen(false)} />
        {/key}
      {/await}
    </div>
  {/if}
  </div>
  {/if}

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
  {#if showCompare && liveProject}
    {#await import("@/features/editor/compare/CompareProjectsModal.svelte") then { default: CompareProjectsModal }}
      <CompareProjectsModal currentProject={liveProject} onClose={() => (showCompare = false)} />
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
  {#if differencesFor}
    {#await import("@/features/connections/DeploymentModal.svelte") then { default: DeploymentModal }}
      <DeploymentModal
        projectId={project.id}
        readOnly
        initialConnectionId={differencesFor}
        onClose={() => (differencesFor = null)}
      />
    {/await}
  {/if}
  {#if lockDialogTable && tableLocks.view.canManage}
    {#await import("@/features/editor/locks/TableLockDialog.svelte") then { default: TableLockDialog }}
      <TableLockDialog
        projectId={project.id}
        tableId={lockDialogTable.id}
        tableName={lockDialogTable.name}
        lock={tableLocks.view.byTable.get(lockDialogTable.id) ?? null}
        canManage={tableLocks.view.canManage}
        onChanged={() => void tableLocks.refresh()}
        onClose={() => (lockDialogTableId = null)}
      />
    {/await}
  {/if}
  {#if seedDialogTable}
    {#await import("@/features/editor/seeds/SeedDialog.svelte") then { default: SeedDialog }}
      <!-- Keyed: another table is another file. -->
      {#key seedDialogTable.id}
        <SeedDialog
          projectId={project.id}
          table={seedDialogTable}
          existing={seeds.byTable.get(seedDialogTable.id) ?? null}
          canEdit={seedEditable(seedDialogTable.id)}
          onClose={() => {
            seedDialogTableId = null;
            void seeds.refresh();
          }}
        />
      {/key}
    {/await}
  {/if}
  <!-- Diagnostics overlay for editor stutter/freezes — hidden until Ctrl+Shift+P, see PerfHud. -->
  {#await import("@/components/dev/PerfHud.svelte") then { default: PerfHud }}
    <PerfHud />
  {/await}
</div>
