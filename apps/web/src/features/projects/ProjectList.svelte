<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { ChevronRightIcon, DatabaseIcon, FolderIcon, PencilIcon, PlusIcon, TrashIcon } from "@/components/icons/Icons";
  import type { ProjectFolder } from "@nebuladb/shared";
  import ConfirmDialog from "@/components/overlays/ConfirmDialog.svelte";
  import FolderNameModal from "@/features/projects/components/FolderNameModal.svelte";
  import MoveProjectModal from "@/features/projects/components/MoveProjectModal.svelte";
  import { countInFolder, folderPath, shownFolderOf } from "@/features/projects/components/folderTree";
  import {
    createFolder,
    deleteFolder,
    fetchFolders,
    moveProjectToFolder,
    updateFolder,
  } from "@/services/variantsApi";
  import { describeApiError } from "@/i18n/serverErrorMessages";
  import { useDraftValue } from "@/hooks/draftValue.svelte";
  import ProjectTeamsModal from "@/features/teams/ProjectTeamsModal.svelte";
  import ProjectTabs from "@/features/projects/components/ProjectTabs.svelte";
  import { PROJECT_SECTIONS } from "@/features/projects/components/projectSections";
  import ProjectCard from "@/features/projects/components/ProjectCard.svelte";
  import DeleteProjectModal from "@/features/projects/components/DeleteProjectModal.svelte";
  import EmptyTrashModal from "@/features/projects/components/EmptyTrashModal.svelte";
  import NewProjectFromDatabaseModal from "@/features/projects/NewProjectFromDatabaseModal.svelte";
  import WebhooksModal from "@/features/projects/components/WebhooksModal.svelte";
  import GlobalSearchResults from "@/features/projects/components/GlobalSearchResults.svelte";
  import type { SearchHit } from "@/services/searchApi";
  import type { CreateProjectFromDatabaseResponse } from "@/services/connectionsApi";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import SkeletonCardGrid from "@/components/ui/SkeletonCardGrid.svelte";
  import Input from "@/components/ui/Input.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { CreateProjectResult } from "@/features/projects/projects.svelte";
  import type { ProjectStatus, ProjectSummary } from "@/types";

  let {
    projects,
    loaded,
    onCreateProject,
    onOpen,
    onOpenSearchHit,
    onRename,
    onSetStatus,
    onDeleteForever,
    onEmptyTrash,
    onProjectCreatedFromDatabase,
    onProjectsChanged,
  }: {
    projects: ProjectSummary[];
    loaded: boolean;
    onCreateProject: (name: string) => Promise<CreateProjectResult>;
    onOpen: (project: ProjectSummary) => void;
    onOpenSearchHit: (hit: SearchHit) => void;
    onRename: (project: ProjectSummary, name: string) => void;
    onSetStatus: (project: ProjectSummary, status: ProjectStatus) => void;
    onDeleteForever: (project: ProjectSummary) => Promise<string | null>;
    onEmptyTrash: (projects: ProjectSummary[]) => Promise<string | null>;
    /** Fired once the modal's `createProjectFromDatabase` call succeeds — the caller refreshes the list and navigates in. */
    onProjectCreatedFromDatabase: (result: CreateProjectFromDatabaseResponse) => void;
    /** A project moved to a folder: the list is fetched again. */
    onProjectsChanged?: () => void;
  } = $props();

  const { t } = useTranslation();
  let section = $state<ProjectStatus>("active");
  let searchQuery = $state("");
  let renamingId = $state<string | null>(null);
  const renamingProject = $derived(projects.find((p) => p.id === renamingId) ?? null);
  const nameDraft = useDraftValue(
    () => renamingProject?.name ?? "",
    (next) => {
      if (renamingProject) onRename(renamingProject, next ?? "");
    },
  );
  let deleteTarget = $state.raw<ProjectSummary | null>(null);
  let deleteError = $state<string | null>(null);
  let deletePending = $state(false);
  let teamsTarget = $state.raw<ProjectSummary | null>(null);
  let webhooksTarget = $state.raw<ProjectSummary | null>(null);
  let emptyTrashOpen = $state(false);
  let emptyTrashError = $state<string | null>(null);
  let emptyTrashPending = $state(false);
  let createError = $state<string | null>(null);
  let creating = $state(false);
  let newFromDatabaseOpen = $state(false);

  function commitRename() {
    nameDraft.commit();
    renamingId = null;
  }

  function openDeleteConfirmation(project: ProjectSummary) {
    deleteError = null;
    deleteTarget = project;
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    deletePending = true;
    const failure = await onDeleteForever(deleteTarget);
    deletePending = false;
    if (failure) deleteError = failure;
    else deleteTarget = null;
  }

  const currentSection = $derived(PROJECT_SECTIONS.find((entry) => entry.key === section)!);
  const normalisedQuery = $derived(searchQuery.trim().toLowerCase());

  // ---- folders: only in the active list and outside a search, which looks everywhere ----
  let folders = $state.raw<ProjectFolder[]>([]);
  let folderError = $state<string | null>(null);
  let currentFolderId = $state<string | null>(null);
  const loadFolders = () =>
    fetchFolders()
      .then((loaded) => {
        folders = loaded;
        // The folder being shown was deleted (here or elsewhere): back to the top.
        if (currentFolderId && !loaded.some((folder) => folder.id === currentFolderId)) currentFolderId = null;
      })
      .catch((err: unknown) => (folderError = describeApiError(err, t)));
  $effect(() => {
    void loadFolders();
  });
  const browsingFolders = $derived(section === "active" && !normalisedQuery);
  const breadcrumb = $derived(folderPath(folders, currentFolderId));
  const subfolders = $derived(
    browsingFolders ? folders.filter((folder) => folder.parentId === currentFolderId) : [],
  );
  const activeProjects = $derived(projects.filter((project) => project.status === "active"));
  let folderDialog = $state<{ mode: "create" } | { mode: "rename"; folder: ProjectFolder } | null>(null);
  let folderToDelete = $state.raw<ProjectFolder | null>(null);
  let moveTarget = $state.raw<ProjectSummary | null>(null);
  const variantCounts = $derived(
    projects.reduce((counts, project) => {
      if (project.variantOf) counts.set(project.variantOf, (counts.get(project.variantOf) ?? 0) + 1);
      return counts;
    }, new Map<string, number>()),
  );
  const projectNames = $derived(new Map(projects.map((project) => [project.id, project.name])));

  async function saveFolder(name: string) {
    if (folderDialog?.mode === "rename") await updateFolder(folderDialog.folder.id, { name });
    else await createFolder(name, currentFolderId);
    await loadFolders();
  }

  async function removeFolder() {
    const folder = folderToDelete;
    folderToDelete = null;
    if (!folder) return;
    try {
      await deleteFolder(folder.id);
      folderError = null;
    } catch (err) {
      folderError = describeApiError(err, t);
    }
    await loadFolders();
    onProjectsChanged?.();
  }

  async function moveProject(folderId: string | null) {
    if (!moveTarget) return;
    await moveProjectToFolder(moveTarget.id, folderId);
    onProjectsChanged?.();
  }

  const visibleProjects = $derived(
    projects
      .filter((project) => project.status === section)
      .filter((project) => (normalisedQuery ? project.name.toLowerCase().includes(normalisedQuery) : true))
      .filter((project) => !browsingFolders || shownFolderOf(folders, project.folderId) === currentFolderId),
  );
  const openable = $derived(section !== "trashed");
  const deletableTrash = $derived(
    projects.filter((project) => project.status === "trashed" && project.permission === "administrator"),
  );

  async function confirmEmptyTrash() {
    emptyTrashPending = true;
    const failure = await onEmptyTrash(deletableTrash);
    emptyTrashPending = false;
    if (failure) emptyTrashError = failure;
    else emptyTrashOpen = false;
  }

  /**
   * Instant-create, Figma-file-browser style: no name dialog, a placeholder
   * name is assigned immediately and the new tile opens straight into rename
   * mode. The created id comes back from the request itself rather than a
   * shared "pending name" field — a previous version threaded the name
   * through a bit of state and fired the create before the state write had
   * landed, so the very first click on a fresh list silently created nothing.
   */
  async function handleCreate() {
    if (creating) return;
    const name = t("projects.newSchemaName", { index: projects.length + 1 });
    createError = null;
    creating = true;
    const result = await onCreateProject(name);
    creating = false;
    if ("error" in result) {
      createError = result.error;
      return;
    }
    if (section !== "active") section = "active";
    // Made inside the folder being shown.
    if (currentFolderId) {
      await moveProjectToFolder(result.id, currentFolderId).catch(() => {});
      onProjectsChanged?.();
    }
    renamingId = result.id;
  }
</script>

<div class="flex h-full min-h-0">
  <div class="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-6 md:px-6">
    <div class="mx-auto max-w-[1040px]">
      <div class="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div class="flex items-center gap-2.5">
          <span class="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-light text-primary">
            <Icon icon={FolderIcon} size={18} />
          </span>
          <div>
            <h1 class="text-xl font-semibold tracking-tight">{t("projects.title")}</h1>
            <p class="text-xs text-text-muted">{t("projects.subtitle")}</p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <Input
            wrapperClassName="w-full sm:w-56"
            placeholder={t("projects.searchPlaceholder")}
            bind:value={searchQuery}
          />
          <Button onclick={() => (folderDialog = { mode: "create" })} class="shrink-0 gap-2 text-xs">
            <Icon icon={FolderIcon} size={14} />
            {t("folders.new")}
          </Button>
          <Button variant="primary" onclick={handleCreate} disabled={creating} class="shrink-0 gap-2 text-xs">
            <Icon icon={PlusIcon} size={14} />
            {creating ? t("projects.creating") : t("projects.newProject")}
          </Button>
          <Button
            onclick={() => (newFromDatabaseOpen = true)}
            class="shrink-0 gap-2 text-xs"
            aria-label={t("projects.newFromDatabase")}
          >
            <Icon icon={DatabaseIcon} size={14} />
          </Button>
        </div>
      </div>

      <div class="mb-4">
        <ProjectTabs {projects} {section} onSectionChange={(next) => (section = next)} />
      </div>

      {#if createError}<ErrorText>{createError}</ErrorText>{/if}
      {#if folderError}<ErrorText>{folderError}</ErrorText>{/if}
      {#if browsingFolders && (breadcrumb.length > 0 || subfolders.length > 0)}
        <nav class="mb-3 flex flex-wrap items-center gap-1 text-xs" aria-label={t("folders.breadcrumb")}>
          <button
            class="cursor-pointer rounded-sm border-0 bg-transparent px-1.5 py-0.5 text-text-muted hover:bg-surface-hover hover:text-text"
            aria-current={currentFolderId === null ? "page" : undefined}
            onclick={() => (currentFolderId = null)}>{t("folders.top")}</button
          >
          {#each breadcrumb as folder (folder.id)}
            <Icon icon={ChevronRightIcon} size={11} class="text-text-muted" />
            <button
              class="cursor-pointer rounded-sm border-0 bg-transparent px-1.5 py-0.5 font-semibold text-text hover:bg-surface-hover"
              aria-current={folder.id === currentFolderId ? "page" : undefined}
              onclick={() => (currentFolderId = folder.id)}>{folder.name}</button
            >
          {/each}
        </nav>
      {/if}
      {#if subfolders.length > 0}
        <div class="mb-4 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {#each subfolders as folder (folder.id)}
            <div
              class="group flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 hover:border-border-strong"
              data-testid="folder-tile"
            >
              <button
                class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-sm font-semibold text-text"
                onclick={() => (currentFolderId = folder.id)}
              >
                <Icon icon={FolderIcon} size={16} class="shrink-0 text-primary" />
                <span class="truncate">{folder.name}</span>
                <span class="shrink-0 text-[11px] font-normal text-text-muted">
                  {t("folders.count", { count: countInFolder(folders, activeProjects, folder.id) })}
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("folders.rename", { name: folder.name })}
                data-tooltip={t("common.rename")}
                onclick={() => (folderDialog = { mode: "rename", folder })}
              >
                <Icon icon={PencilIcon} size={12} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("folders.delete", { name: folder.name })}
                data-tooltip={t("common.delete")}
                onclick={() => (folderToDelete = folder)}
              >
                <Icon icon={TrashIcon} size={12} />
              </Button>
            </div>
          {/each}
        </div>
      {/if}
      {#if section === "trashed" && deletableTrash.length > 0}
        <div class="mb-3 flex justify-end">
          <Button
            variant="danger"
            size="sm"
            onclick={() => {
              emptyTrashError = null;
              emptyTrashOpen = true;
            }}
          >
            <Icon icon={TrashIcon} size={13} />
            {t("projects.emptyTrash.button", { count: deletableTrash.length })}
          </Button>
        </div>
      {/if}
      {#if !loaded}
        <!-- Placeholders, not the empty state: before the fetch settles an
             empty array means "unknown", and claiming the user has no
             projects is a wrong statement rather than a slow one. -->
        <SkeletonCardGrid count={4} />
      {:else if visibleProjects.length === 0}
        {#if !(browsingFolders && (currentFolderId || subfolders.length > 0))}
          <EmptyState>{normalisedQuery ? t("projects.noSearchMatch") : t(currentSection.emptyKey)}</EmptyState>
        {:else if currentFolderId}
          <EmptyState>{t("folders.empty")}</EmptyState>
        {/if}
      {:else}
        <div class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {#each visibleProjects as project (project.id)}
            <ProjectCard
              {project}
              {section}
              {openable}
              isRenaming={renamingId === project.id}
              nameDraft={nameDraft.value}
              onNameDraftChange={nameDraft.setValue}
              onOpen={() => onOpen(project)}
              onStartRename={() => (renamingId = project.id)}
              onCommitRename={commitRename}
              onCancelRename={() => (renamingId = null)}
              onSetStatus={(status) => onSetStatus(project, status)}
              onDeleteForever={() => openDeleteConfirmation(project)}
              onManageTeams={() => (teamsTarget = project)}
              onManageWebhooks={() => (webhooksTarget = project)}
              onMove={() => (moveTarget = project)}
              variantOfName={project.variantOf ? (projectNames.get(project.variantOf) ?? null) : null}
              variantCount={variantCounts.get(project.id) ?? 0}
            />
          {/each}
        </div>
      {/if}
      <GlobalSearchResults query={searchQuery} onOpenHit={onOpenSearchHit} />
    </div>
  </div>

  {#if deleteTarget}
    <DeleteProjectModal
      target={deleteTarget}
      busy={deletePending}
      error={deleteError}
      onConfirm={confirmDelete}
      onClose={() => (deleteTarget = null)}
    />
  {/if}
  {#if emptyTrashOpen}
    <EmptyTrashModal
      count={deletableTrash.length}
      busy={emptyTrashPending}
      error={emptyTrashError}
      onConfirm={confirmEmptyTrash}
      onClose={() => (emptyTrashOpen = false)}
    />
  {/if}
  {#if newFromDatabaseOpen}
    <NewProjectFromDatabaseModal
      onClose={() => (newFromDatabaseOpen = false)}
      onCreated={(result) => {
        newFromDatabaseOpen = false;
        onProjectCreatedFromDatabase(result);
      }}
    />
  {/if}
  {#if webhooksTarget}
    <WebhooksModal project={webhooksTarget} onClose={() => (webhooksTarget = null)} />
  {/if}
  {#if folderDialog}
    <FolderNameModal
      title={folderDialog.mode === "rename" ? t("folders.renameTitle") : t("folders.new")}
      initialName={folderDialog.mode === "rename" ? folderDialog.folder.name : ""}
      onSave={saveFolder}
      onClose={() => (folderDialog = null)}
    />
  {/if}
  {#if folderToDelete}
    <ConfirmDialog
      title={t("folders.deleteTitle", { name: folderToDelete.name })}
      message={t("folders.deleteMessage")}
      danger="warning"
      confirmLabel={t("common.delete")}
      onCancel={() => (folderToDelete = null)}
      onConfirm={() => void removeFolder()}
    />
  {/if}
  {#if moveTarget}
    <MoveProjectModal
      projectName={moveTarget.name}
      currentFolderId={shownFolderOf(folders, moveTarget.folderId)}
      {folders}
      onMove={moveProject}
      onClose={() => (moveTarget = null)}
    />
  {/if}
  {#if teamsTarget}
    <ProjectTeamsModal project={teamsTarget} onClose={() => (teamsTarget = null)} />
  {/if}
</div>
