<script lang="ts">
  import type { Project } from "@nebuladb/shared";
  import type { HistoryPreviewState } from "@/features/editor/history/historyPreview.svelte";
  import type { LintState } from "@/features/editor/lint/lint.svelte";
  import type { SchemaQuality } from "@/features/editor/lint/schemaQuality.svelte";
  import type { ProjectConnectionsState } from "@/features/editor/projectConnections.svelte";
  import type { WorkspaceTab } from "@/features/projects/projectRouting.svelte";
  import type { RevisionSummary } from "@/services/projectsApi";
  import type { ProjectSummary, Session } from "@/types/index";
  import { fingerprintSchema } from "@nebuladb/dbml-engine";

  /**
   * The workspace tabs that replace the editor rather than cover it — an
   * unmounted canvas has no keyboard shortcuts, clipboard handlers or
   * selection to act on by accident. Each panel is code-split; the document
   * connection lives in the editor above, so nothing is lost on a switch.
   */
  let {
    tab,
    project,
    liveProject,
    session,
    user,
    databases,
    quality,
    lint,
    history,
    canWrite,
    canDeploy,
    isProjectAdmin,
    deploymentsSeen,
    reviewsSeen,
    onDeployed,
    onOpenProject,
    setTab,
    onOpenTable,
    onPreviewRevision,
  }: {
    tab: WorkspaceTab;
    project: ProjectSummary;
    liveProject: Project | null;
    session: Session;
    user: string;
    databases: ProjectConnectionsState;
    quality: SchemaQuality;
    lint: LintState;
    history: HistoryPreviewState;
    canWrite: boolean;
    canDeploy: boolean;
    isProjectAdmin: boolean;
    deploymentsSeen: number;
    reviewsSeen: number;
    onDeployed: () => void;
    onOpenProject?: (projectId: string) => void;
    setTab: (tab: WorkspaceTab) => void;
    /** Leaves the panel for the schema, centred on a table (and a column). */
    onOpenTable: (tableName: string, fieldName?: string) => void;
    onPreviewRevision: (revision: RevisionSummary, project: Project) => void;
  } = $props();
</script>

{#if tab === "deployments"}
  {#await import("@/features/workspace/DeploymentsTab.svelte") then { default: DeploymentsTab }}
    <DeploymentsTab
      projectId={project.id}
      connection={databases.activeConnection}
      connections={databases.connections}
      refreshKey={deploymentsSeen}
      reviewsKey={reviewsSeen}
      schemaHash={liveProject ? fingerprintSchema(liveProject).hash : undefined}
      tableNames={liveProject?.tables.map((table) => table.name) ?? []}
      onDeployTo={(id) => (databases.connectionId = id)}
      onOpenTable={(tableName) => onOpenTable(tableName)}
      {canDeploy}
      canManage={isProjectAdmin}
      canSkipStage={session.isAdmin}
      onDeployed={onDeployed}
      onShowProblems={() => setTab("problems")}
    />
  {/await}
{:else if tab === "problems"}
  {#await import("@/features/editor/lint/ProblemsPanel.svelte") then { default: ProblemsPanel }}
    <ProblemsPanel
      findings={quality.findings}
      settings={lint.settings}
      source={lint.source}
      presets={lint.presets}
      canFix={quality.canEditTable}
      canManage={isProjectAdmin}
      onOpenTable={onOpenTable}
      onFix={quality.fix}
      onSaveSettings={lint.save}
      onChoosePreset={lint.choosePreset}
    />
  {/await}
{:else if tab === "dictionary" && liveProject}
  {#await import("@/features/editor/dictionary/DictionaryPanel.svelte") then { default: DictionaryPanel }}
    <DictionaryPanel
      project={liveProject}
      canEdit={quality.canEditTable}
      onOpenTable={onOpenTable}
      onSaveTableNote={quality.saveTableNote}
      onSaveFieldNote={quality.saveFieldNote}
    />
  {/await}
{:else if tab === "variants"}
  {#await import("@/features/workspace/variants/VariantsPanel.svelte") then { default: VariantsPanel }}
    <VariantsPanel {project} {onOpenProject} />
  {/await}
{:else if tab === "history" && liveProject}
  {#await import("@/features/editor/history/HistoryPanel.svelte") then { default: HistoryPanel }}
    <HistoryPanel
      projectId={project.id}
      currentProject={liveProject}
      currentUser={user}
      initialRevisionId={history.revisionId}
      canRestore={canWrite}
      onPreview={onPreviewRevision}
      onClose={() => {
        history.close();
        setTab("schema");
      }}
    />
  {/await}
{/if}
