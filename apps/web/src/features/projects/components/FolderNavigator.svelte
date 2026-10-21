<script lang="ts">
  import type { ProjectFolder } from "@nebuladb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { ChevronRightIcon, FolderIcon, PencilIcon, TrashIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import { countInFolder } from "@/features/projects/components/folderTree";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { ProjectSummary } from "@/types";

  /**
   * The folders of the project list: the breadcrumb of where you are and the
   * tiles of the folders below it. Both are drop targets for dragging a
   * project (the drag state lives in the list; this only spreads what it is
   * given onto each target).
   */
  let {
    folders,
    activeProjects,
    breadcrumb,
    subfolders,
    currentFolderId,
    showBreadcrumb,
    onOpenFolder,
    onRenameFolder,
    onDeleteFolder,
    onFolderMenu,
    dropProps,
    dropClass,
  }: {
    folders: ProjectFolder[];
    activeProjects: ProjectSummary[];
    breadcrumb: ProjectFolder[];
    subfolders: ProjectFolder[];
    currentFolderId: string | null;
    showBreadcrumb: boolean;
    onOpenFolder: (id: string | null) => void;
    onRenameFolder: (folder: ProjectFolder) => void;
    onDeleteFolder: (folder: ProjectFolder) => void;
    onFolderMenu: (event: MouseEvent, folder: ProjectFolder) => void;
    dropProps: (folderId: string | null) => Record<string, unknown>;
    dropClass: (folderId: string | null) => string;
  } = $props();

  const { t } = useTranslation();
</script>

{#if showBreadcrumb}
  <nav class="mb-3 flex flex-wrap items-center gap-1 text-label" aria-label={t("folders.breadcrumb")}>
    <button
      class={`cursor-pointer rounded-sm border-0 bg-transparent px-1.5 py-0.5 text-text-muted hover:bg-surface-hover hover:text-text ${dropClass(null)}`}
      aria-current={currentFolderId === null ? "page" : undefined}
      onclick={() => onOpenFolder(null)}
      {...dropProps(null)}>{t("folders.top")}</button
    >
    {#each breadcrumb as folder (folder.id)}
      <Icon icon={ChevronRightIcon} size={11} class="text-text-muted" />
      <button
        class={`cursor-pointer rounded-sm border-0 bg-transparent px-1.5 py-0.5 font-semibold text-text hover:bg-surface-hover ${dropClass(folder.id)}`}
        aria-current={folder.id === currentFolderId ? "page" : undefined}
        onclick={() => onOpenFolder(folder.id)}
        {...dropProps(folder.id)}>{folder.name}</button
      >
    {/each}
  </nav>
{/if}
{#if subfolders.length > 0}
  <div class="mb-4 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
    {#each subfolders as folder (folder.id)}
      <div
        class={`group flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 hover:border-border-strong ${dropClass(folder.id)}`}
        data-testid="folder-tile"
        role="group"
        aria-label={folder.name}
        oncontextmenu={(event) => onFolderMenu(event, folder)}
        {...dropProps(folder.id)}
      >
        <button
          class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-title font-semibold text-text"
          onclick={() => onOpenFolder(folder.id)}
        >
          <Icon icon={FolderIcon} size={16} class="shrink-0 text-primary" />
          <span class="truncate">{folder.name}</span>
          <span class="shrink-0 text-caption font-normal text-text-muted">
            {t("folders.count", { count: countInFolder(folders, activeProjects, folder.id) })}
          </span>
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("folders.rename", { name: folder.name })}
          data-tooltip={t("common.rename")}
          onclick={() => onRenameFolder(folder)}
        >
          <Icon icon={PencilIcon} size={12} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("folders.delete", { name: folder.name })}
          data-tooltip={t("common.delete")}
          onclick={() => onDeleteFolder(folder)}
        >
          <Icon icon={TrashIcon} size={12} />
        </Button>
      </div>
    {/each}
  </div>
{/if}
