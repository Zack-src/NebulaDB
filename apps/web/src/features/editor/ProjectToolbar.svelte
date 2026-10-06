<script lang="ts" module>
  import type { IconDefinition } from "@/components/icons/iconDefinition";
  import type { TranslationKeyOf } from "@/types";

  const DIVIDER_CLASS = "mx-1 h-5 w-px shrink-0 bg-border";

  interface ToolbarAction {
    icon: IconDefinition;
    labelKey: TranslationKeyOf;
    onClick: () => void;
  }
</script>

<script lang="ts">
  import FollowMenu from "@/features/notifications/FollowMenu.svelte";
  import NotificationBell from "@/features/notifications/NotificationBell.svelte";
  import PresenceList from "@/features/collaboration/PresenceList.svelte";
  import type { AwarenessState } from "@/features/collaboration/yjsClient";
  import Button from "@/components/ui/Button.svelte";
  import { APP_HEADER } from "@/components/ui/layout";
  import BrandMark from "@/components/ui/BrandMark.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import {
    ChevronLeftIcon,
    DownloadIcon,
    RedoIcon,
    SettingsIcon,
    UndoIcon,
    UploadIcon,
  } from "@/components/icons/Icons";
  import { useTranslation } from "@/i18n/i18n.svelte";

  let props: {
    projectName: string;
    viewOnly: boolean;
    onBack: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onShowImport: () => void;
    onShowExport: () => void;
    onOpenSettings?: () => void;
    /** Present in the real app: the project to follow, and where a notification about another one leads. */
    follow?: { projectId: string; onOpenProject: (projectId: string) => void };
    localUser: string;
    remoteAwareness: Map<number, AwarenessState>;
  } = $props();

  const { t } = useTranslation();

  // Export is a read — a viewer keeps it (history is a tab of the workspace
  // bar, not a button here). Import writes, so it
  // is dropped entirely rather than disabled: a viewer has no path to make it
  // work. Plugins lives only in the canvas toolbar.
  const panelActions = $derived<ToolbarAction[]>([
    ...(props.viewOnly ? [] : [{ icon: UploadIcon, labelKey: "editor.import", onClick: props.onShowImport } as const]),
    { icon: DownloadIcon, labelKey: "editor.export", onClick: props.onShowExport },
  ]);

  const historyActions = $derived<ToolbarAction[]>(
    props.viewOnly
      ? []
      : [
          { icon: UndoIcon, labelKey: "editor.undo", onClick: props.onUndo },
          { icon: RedoIcon, labelKey: "editor.redo", onClick: props.onRedo },
        ],
  );
</script>

<header class={`${APP_HEADER} justify-between gap-3 !px-3`}>
  <div class="flex min-w-0 items-center gap-1">
    <Button
      variant="ghost"
      size="icon-sm"
      onclick={props.onBack}
      data-tooltip={t("admin.backToProjects")}
      data-tooltip-pos="bottom"
      aria-label={t("admin.backToProjects")}
    >
      <Icon icon={ChevronLeftIcon} size={16} />
    </Button>
    <div class="flex min-w-0 items-center gap-2 pl-1 pr-2">
      <BrandMark size={24} iconSize={13} />
      <span class="truncate text-sm font-bold tracking-tight text-text">{props.projectName}</span>
      {#if props.viewOnly}
        <span class="shrink-0" data-tooltip={t("editor.viewOnlyHint")} data-tooltip-pos="bottom">
          <Badge tone="muted">{t("projects.card.readOnly")}</Badge>
        </span>
      {/if}
    </div>

    {#if historyActions.length > 0}<span class={DIVIDER_CLASS}></span>{/if}

    <div class="flex items-center gap-0.5">
      {#each historyActions as action (action.labelKey)}
        <Button
          size="icon-sm"
          variant="ghost"
          onclick={action.onClick}
          data-tooltip={t(action.labelKey)}
          data-tooltip-pos="bottom"
          aria-label={t(action.labelKey)}
        >
          <Icon icon={action.icon} size={14} />
        </Button>
      {/each}
    </div>
  </div>

  <div class="flex shrink-0 items-center gap-1.5">
    <div class="hidden items-center gap-0.5 md:flex">
      {#each panelActions as action (action.labelKey)}
        <Button size="sm" variant="ghost" onclick={action.onClick}>
          <Icon icon={action.icon} size={14} />
          <span class="hidden lg:inline">{t(action.labelKey)}</span>
        </Button>
      {/each}
    </div>

    <span class={`${DIVIDER_CLASS} hidden md:block`}></span>

    <PresenceList localName={props.localUser} remote={props.remoteAwareness} />

    {#if props.follow}
      <FollowMenu projectId={props.follow.projectId} />
      <NotificationBell onOpenProject={props.follow.onOpenProject} />
    {/if}
    {#if props.onOpenSettings}
      <Button
        variant="ghost"
        size="icon-sm"
        onclick={props.onOpenSettings}
        data-tooltip={t("common.settings")}
        data-tooltip-pos="bottom"
        aria-label={t("common.settings")}
      >
        <Icon icon={SettingsIcon} size={15} />
      </Button>
    {/if}
  </div>
</header>
