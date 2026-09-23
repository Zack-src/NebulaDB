<script lang="ts" module>
  const ACCENTS = ["#6366f1", "#a855f7", "#06b6d4", "#10b981", "#f59e0b", "#ec4899"];
</script>

<script lang="ts">
  import { MAX_NAME_LENGTH } from "@athanordb/shared";
  import { autofocus } from "@/actions/autofocus";
  import Icon from "@/components/icons/Icon.svelte";
  import { ArchiveIcon, LinkIcon, PencilIcon, RestoreIcon, TrashIcon, UsersIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import { INPUT_SM_CLASS } from "@/components/ui/inputStyles";
  import { formatDate } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import type { ProjectStatus, ProjectSummary } from "@/types";
  import ProjectThumbnail, { hashOfId } from "./ProjectThumbnail.svelte";

  /** One project tile: open-on-click, plus the per-section actions admins get. */
  let {
    project,
    section,
    openable,
    isRenaming,
    nameDraft,
    onNameDraftChange,
    onOpen,
    onStartRename,
    onCommitRename,
    onCancelRename,
    onSetStatus,
    onDeleteForever,
    onManageTeams,
    onManageWebhooks,
  }: {
    project: ProjectSummary;
    section: ProjectStatus;
    openable: boolean;
    isRenaming: boolean;
    nameDraft: string;
    onNameDraftChange: (value: string) => void;
    onOpen: () => void;
    onStartRename: () => void;
    onCommitRename: () => void;
    onCancelRename: () => void;
    onSetStatus: (status: ProjectStatus) => void;
    onDeleteForever: () => void;
    onManageTeams: () => void;
    onManageWebhooks: () => void;
  } = $props();

  const { t } = useTranslation();
  const accent = $derived(ACCENTS[hashOfId(project.id) % ACCENTS.length]);

  /** Every action button sits inside the clickable card, so none of them may also open the project. */
  function action(run: () => void) {
    return (event: MouseEvent) => {
      event.stopPropagation();
      run();
    };
  }
</script>

<!-- `role` is "button" whenever `tabindex` is set; the checker cannot see that through the conditional. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class={`group block w-full overflow-hidden rounded-xl border border-border bg-surface text-left shadow-xs transition-[box-shadow,transform,border-color] duration-150 ${
    openable ? "cursor-pointer hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md" : "cursor-default"
  }`}
  role={openable ? "button" : undefined}
  tabindex={openable ? 0 : undefined}
  onclick={() => openable && !isRenaming && onOpen()}
  onkeydown={(event) => {
    if (!openable || isRenaming) return;
    // The card holds buttons and a rename field inside it. Without this
    // guard, Enter or Space on any of them bubbled up here and opened the
    // project as well — so archiving a project from the keyboard also
    // navigated into it. The check has to come before `preventDefault`,
    // or Space on a nested button gets swallowed instead.
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  }}
>
  <ProjectThumbnail id={project.id} {accent} />

  <div class="p-3">
    <div class="flex items-start justify-between gap-2">
      {#if isRenaming}
        <input
          use:autofocus
          class={`${INPUT_SM_CLASS} mb-0.5 w-full font-semibold`}
          value={nameDraft}
          maxlength={MAX_NAME_LENGTH}
          onclick={(event) => event.stopPropagation()}
          oninput={(event) => onNameDraftChange(event.currentTarget.value)}
          onblur={onCommitRename}
          onkeydown={(event) => {
            if (event.key === "Enter") onCommitRename();
            if (event.key === "Escape") {
              event.stopPropagation();
              onCancelRename();
            }
          }}
        />
      {:else}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="mb-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold text-text"
          data-tooltip={openable ? t("projects.card.doubleClickToRename") : undefined}
          ondblclick={(event) => {
            if (!openable) return;
            event.stopPropagation();
            onStartRename();
          }}
        >
          {project.name}
        </div>
      {/if}

      <!-- Server re-checks every mutating call regardless — this is UX only, never the security boundary. -->
      {#if project.permission === "administrator"}
        <div
          class="flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
        >
          {#if section === "trashed"}
            <Button
              variant="ghost"
              size="icon-sm"
              data-tooltip={t("projects.card.restore")}
              onclick={action(() => onSetStatus("active"))}
            >
              <Icon icon={RestoreIcon} size={13} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              data-tooltip={t("projects.deleteForever.action")}
              onclick={action(onDeleteForever)}
            >
              <Icon icon={TrashIcon} size={13} />
            </Button>
          {:else}
            <Button variant="ghost" size="icon-sm" data-tooltip={t("common.rename")} onclick={action(onStartRename)}>
              <Icon icon={PencilIcon} size={13} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              data-tooltip={t("projects.card.manageTeams")}
              onclick={action(onManageTeams)}
            >
              <Icon icon={UsersIcon} size={13} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              data-tooltip={t("projects.card.webhooks")}
              aria-label={t("projects.card.webhooks")}
              onclick={action(onManageWebhooks)}
            >
              <Icon icon={LinkIcon} size={13} />
            </Button>
            {#if section === "archived"}
              <Button
                variant="ghost"
                size="icon-sm"
                data-tooltip={t("projects.card.restore")}
                onclick={action(() => onSetStatus("active"))}
              >
                <Icon icon={RestoreIcon} size={13} />
              </Button>
            {:else}
              <Button
                variant="ghost"
                size="icon-sm"
                data-tooltip={t("projects.card.archive")}
                onclick={action(() => onSetStatus("archived"))}
              >
                <Icon icon={ArchiveIcon} size={13} />
              </Button>
            {/if}
            <Button
              variant="ghost"
              size="icon-sm"
              data-tooltip={t("projects.card.moveToTrash")}
              onclick={action(() => onSetStatus("trashed"))}
            >
              <Icon icon={TrashIcon} size={13} />
            </Button>
          {/if}
        </div>
      {/if}
    </div>

    <div class="flex items-center gap-1.5 text-[11px] text-text-muted">
      <span class="h-1.5 w-1.5 shrink-0 rounded-full" style:background={accent}></span>
      {t("projects.card.createdOn", { date: formatDate(project.created_at, i18n.locale) })}
      {#if project.permission === "view"}
        <Badge tone="muted" class="ml-1">{t("projects.card.readOnly")}</Badge>
      {/if}
    </div>
  </div>
</div>
