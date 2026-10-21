<script lang="ts">
  import type { ProjectFolder } from "@nebuladb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { FolderIcon } from "@/components/icons/Icons";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { folderPath } from "./folderTree";

  /** Puts a project in a folder, or back at the top: every folder listed with its path. */
  let {
    projectName,
    currentFolderId,
    folders,
    onMove,
    onClose,
  }: {
    projectName: string;
    currentFolderId: string | null;
    folders: ProjectFolder[];
    onMove: (folderId: string | null) => Promise<void>;
    onClose: () => void;
  } = $props();

  const { t } = useTranslation();
  const choices = $derived([
    { id: null, label: t("folders.top") },
    ...folders
      .map((folder) => ({ id: folder.id as string | null, label: folderPath(folders, folder.id).map((f) => f.name).join(" / ") }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ]);
  const move = useAsyncAction(async (folderId: string | null) => {
    await onMove(folderId);
    onClose();
  });
</script>

<Modal title={t("folders.moveTitle", { name: projectName })} {onClose} dismissable={!move.pending}>
  <ul class="m-0 max-h-80 list-none space-y-0.5 overflow-y-auto p-0" data-testid="move-project">
    {#each choices as choice (choice.id ?? "top")}
      <li>
        <button
          class="flex w-full cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent px-2 py-1.5 text-left text-xs text-text hover:bg-surface-hover disabled:cursor-default disabled:opacity-50"
          disabled={move.pending || choice.id === currentFolderId}
          onclick={() => void move.run(choice.id)}
        >
          <Icon icon={FolderIcon} size={13} class="text-text-muted" />
          {choice.label}
          {#if choice.id === currentFolderId}<span class="ml-auto text-caption text-text-muted">{t("folders.here")}</span>{/if}
        </button>
      </li>
    {/each}
  </ul>
  {#if move.error}<ErrorText>{move.error}</ErrorText>{/if}
  <div class="mt-3 flex justify-end">
    <Button size="sm" variant="ghost" onclick={onClose}>{t("common.cancel")}</Button>
  </div>
</Modal>
