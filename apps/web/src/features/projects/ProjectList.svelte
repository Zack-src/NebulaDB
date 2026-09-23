<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import type { ProjectTemplateId } from "@athanordb/dbml-engine";
  import { FolderIcon, LayoutGridIcon, PlusIcon, TrashIcon } from "@/components/icons/Icons";
  import { useDraftValue } from "@/hooks/draftValue.svelte";
  import ProjectTeamsModal from "@/features/teams/ProjectTeamsModal.svelte";
  import ProjectTabs from "@/features/projects/components/ProjectTabs.svelte";
  import { PROJECT_SECTIONS } from "@/features/projects/components/projectSections";
  import ProjectCard from "@/features/projects/components/ProjectCard.svelte";
  import DeleteProjectModal from "@/features/projects/components/DeleteProjectModal.svelte";
  import EmptyTrashModal from "@/features/projects/components/EmptyTrashModal.svelte";
  import TemplatePickerModal from "@/features/projects/components/TemplatePickerModal.svelte";
  import { TEMPLATE_COPY } from "@/features/projects/components/templateCopy";
  import GlobalSearchResults from "@/features/projects/components/GlobalSearchResults.svelte";
  import type { SearchHit } from "@/services/searchApi";
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
  }: {
    projects: ProjectSummary[];
    loaded: boolean;
    onCreateProject: (name: string, template?: ProjectTemplateId) => Promise<CreateProjectResult>;
    onOpen: (project: ProjectSummary) => void;
    onOpenSearchHit: (hit: SearchHit) => void;
    onRename: (project: ProjectSummary, name: string) => void;
    onSetStatus: (project: ProjectSummary, status: ProjectStatus) => void;
    onDeleteForever: (project: ProjectSummary) => Promise<string | null>;
    onEmptyTrash: (projects: ProjectSummary[]) => Promise<string | null>;
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
  let emptyTrashOpen = $state(false);
  let emptyTrashError = $state<string | null>(null);
  let emptyTrashPending = $state(false);
  let createError = $state<string | null>(null);
  let creating = $state(false);
  let templatePickerOpen = $state(false);
  let templateError = $state<string | null>(null);

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
  const visibleProjects = $derived(
    projects
      .filter((project) => project.status === section)
      .filter((project) => (normalisedQuery ? project.name.toLowerCase().includes(normalisedQuery) : true)),
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
    renamingId = result.id;
  }

  /** Same instant-create-then-rename flow, named after the template rather than "New schema N". */
  async function handleCreateFromTemplate(template: ProjectTemplateId) {
    if (creating) return;
    templateError = null;
    creating = true;
    const result = await onCreateProject(t(TEMPLATE_COPY[template].name), template);
    creating = false;
    if ("error" in result) {
      templateError = result.error;
      return;
    }
    templatePickerOpen = false;
    if (section !== "active") section = "active";
    renamingId = result.id;
  }

  function openTemplatePicker() {
    templateError = null;
    templatePickerOpen = true;
  }
</script>

<div class="flex h-full min-h-0">
  <!-- Left rail — Figma-style section nav -->
  <aside class="hidden w-56 shrink-0 flex-col gap-4 border-r border-border/60 bg-surface/40 p-4 sm:flex">
    <Button variant="primary" onclick={handleCreate} disabled={creating} class="w-full gap-2 text-xs">
      <Icon icon={PlusIcon} size={14} />
      {creating ? t("projects.creating") : t("projects.newProject")}
    </Button>
    <Button onclick={openTemplatePicker} disabled={creating} class="-mt-2 w-full gap-2 text-xs">
      <Icon icon={LayoutGridIcon} size={14} />
      {t("projects.fromTemplate")}
    </Button>
    <ProjectTabs {projects} {section} onSectionChange={(next) => (section = next)} />
  </aside>

  <div class="min-h-0 flex-1 overflow-y-auto px-6 py-8">
    <div class="mx-auto max-w-[1040px]">
      <div class="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div class="flex items-center gap-2.5">
          <span class="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-light text-primary">
            <Icon icon={FolderIcon} size={18} />
          </span>
          <div>
            <h1 class="text-xl font-extrabold tracking-tight">{t("projects.title")}</h1>
            <p class="text-xs text-text-muted">{t("projects.subtitle")}</p>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <Input wrapperClassName="w-full sm:w-56" placeholder={t("projects.searchPlaceholder")} bind:value={searchQuery} />
          <Button variant="primary" onclick={handleCreate} disabled={creating} class="shrink-0 gap-2 text-xs sm:hidden">
            <Icon icon={PlusIcon} size={14} />
            {t("projects.new")}
          </Button>
          <Button onclick={openTemplatePicker} disabled={creating} class="shrink-0 gap-2 text-xs sm:hidden">
            <Icon icon={LayoutGridIcon} size={14} />
            {t("projects.fromTemplate")}
          </Button>
        </div>
      </div>

      <!-- Section nav collapses here on narrow viewports, where the rail is hidden -->
      <div class="mb-4 sm:hidden">
        <ProjectTabs {projects} {section} onSectionChange={(next) => (section = next)} />
      </div>

      {#if createError}<ErrorText>{createError}</ErrorText>{/if}
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
        <EmptyState>{normalisedQuery ? t("projects.noSearchMatch") : t(currentSection.emptyKey)}</EmptyState>
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
  {#if templatePickerOpen}
    <TemplatePickerModal
      busy={creating}
      error={templateError}
      onPick={handleCreateFromTemplate}
      onClose={() => (templatePickerOpen = false)}
    />
  {/if}
  {#if teamsTarget}
    <ProjectTeamsModal project={teamsTarget} onClose={() => (teamsTarget = null)} />
  {/if}
</div>
