<script lang="ts">
  import type { Project } from "@nebuladb/shared";
  import type { createProjectMutations } from "@/features/editor/hooks/projectMutations";
  import type { ProjectConnectionsState } from "@/features/editor/projectConnections.svelte";
  import type { TableLocksState } from "@/features/editor/locks/tableLocks.svelte";
  import type { SeedsState } from "@/features/editor/seeds/seeds.svelte";
  import type { CanvasImageCapture, ProjectSummary, Session } from "@/types/index";

  /**
   * The editor's dialogs. Each is code-split — none of them is in the chunk a
   * project view loads — and opens from a flag the editor owns, so the flags
   * are bindable and the dialogs close themselves by clearing them.
   */
  let {
    project,
    liveProject,
    session,
    canWrite,
    showImport = $bindable(),
    showExport = $bindable(),
    showConvertTypes = $bindable(),
    showPlugins = $bindable(),
    showLocksList = $bindable(),
    lockDialogTableId = $bindable(),
    seedDialogTableId = $bindable(),
    seedFromDatabase,
    tableLocks,
    seeds,
    databases,
    captureCanvasImage,
    onConvertFieldTypes,
    onOpenTable,
  }: {
    project: ProjectSummary;
    liveProject: Project | null;
    session: Session;
    canWrite: boolean;
    showImport: boolean;
    showExport: boolean;
    showConvertTypes: boolean;
    showPlugins: boolean;
    showLocksList: boolean;
    lockDialogTableId: string | null;
    seedDialogTableId: string | null;
    /** Set when the seed dialog was opened from the console to take the database's rows. */
    seedFromDatabase: boolean;
    tableLocks: TableLocksState;
    seeds: SeedsState;
    databases: ProjectConnectionsState;
    captureCanvasImage: (format: "png" | "svg") => Promise<CanvasImageCapture>;
    onConvertFieldTypes: ReturnType<typeof createProjectMutations>["convertFieldTypes"];
    /** Leaves the dialog for the schema, centred on a table. */
    onOpenTable: (tableName: string) => void;
  } = $props();

  const seedDialogTable = $derived(
    seedDialogTableId ? (liveProject?.tables.find((table) => table.id === seedDialogTableId) ?? null) : null,
  );
  const lockDialogTable = $derived(
    lockDialogTableId ? (liveProject?.tables.find((table) => table.id === lockDialogTableId) ?? null) : null,
  );
  /** A `full` lock freezes the rows as well as the shape, for whoever it binds. */
  const seedEditable = (tableId: string) =>
    canWrite && !(tableLocks.view.byTable.get(tableId)?.level === "full" && tableLocks.view.frozen.has(tableId));
</script>

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
      onApply={onConvertFieldTypes}
      onClose={() => (showConvertTypes = false)}
    />
  {/await}
{/if}
{#if showPlugins}
  {#await import("@/features/plugins/PluginManagerDialog.svelte") then { default: PluginManagerDialog }}
    <PluginManagerDialog onClose={() => (showPlugins = false)} />
  {/await}
{/if}
{#if showLocksList && liveProject}
  {#await import("@/features/editor/locks/TableLocksList.svelte") then { default: TableLocksList }}
    <TableLocksList
      projectId={project.id}
      view={tableLocks.view}
      tableNames={new Map(liveProject.tables.map((table) => [table.id, table.name]))}
      onOpenTable={(tableName) => {
        showLocksList = false;
        onOpenTable(tableName);
      }}
      onManage={(tableId) => {
        showLocksList = false;
        lockDialogTableId = tableId;
      }}
      onChanged={() => void tableLocks.refresh()}
      onClose={() => (showLocksList = false)}
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
        refs={liveProject?.refs ?? []}
        existing={seeds.byTable.get(seedDialogTable.id) ?? null}
        canEdit={seedEditable(seedDialogTable.id)}
        database={session.isAdmin && databases.activeConnection
          ? { id: databases.activeConnection.id, name: databases.activeConnection.name }
          : null}
        loadFromDatabase={seedFromDatabase}
        isAdmin={session.isAdmin}
        onClose={() => {
          seedDialogTableId = null;
          void seeds.refresh();
        }}
      />
    {/key}
  {/await}
{/if}
