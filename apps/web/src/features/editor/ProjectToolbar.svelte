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
  import PresenceList from "@/features/collaboration/PresenceList.svelte";
  import type { AwarenessState, ConnectionStatus } from "@/features/collaboration/yjsClient";
  import Button from "@/components/ui/Button.svelte";
  import { APP_HEADER } from "@/components/ui/layout";
  import BrandMark from "@/components/ui/BrandMark.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import {
    ChevronLeftIcon,
    ClockIcon,
    DownloadIcon,
    LayersIcon,
    LayoutGridIcon,
    RedoIcon,
    SettingsIcon,
    SparklesIcon,
    SwapHorizontalIcon,
    UndoIcon,
    UploadIcon,
  } from "@/components/icons/Icons";
  import { useTranslation } from "@/i18n/i18n.svelte";

  let props: {
    projectName: string;
    viewOnly: boolean;
    connection: ConnectionStatus;
    /** False until the first sync lands, even when the socket itself is already open. */
    synced: boolean;
    onBack: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onAutoLayout: () => void;
    onShowImport: () => void;
    onShowExport: () => void;
    onShowConvertTypes?: () => void;
    onShowHistory: () => void;
    onShowCompare: () => void;
    onShowDeploy?: () => void;
    /**
     * `edit` is enough to change the schema, but a deployment reaches a live
     * database — a network host or local file the connection (now managed only
     * from the admin console) points at — and executes arbitrary generated SQL
     * against it, a materially larger blast radius than a canvas edit. The
     * connections/deployment routes already enforce project `administrator`
     * server-side; this hides the button for anyone who'd just get a 403
     * clicking it, rather than leaving that as the only signal they lack access.
     */
    isProjectAdmin: boolean;
    onOpenSettings?: () => void;
    localUser: string;
    localColor: string;
    remoteAwareness: Map<number, AwarenessState>;
  } = $props();

  const { t } = useTranslation();

  // Export and history are reads — a viewer keeps them. Import writes, so it
  // is dropped entirely rather than disabled: a viewer has no path to make it
  // work. Plugins lives only in the canvas toolbar.
  const panelActions = $derived<ToolbarAction[]>([
    ...(props.viewOnly ? [] : [{ icon: UploadIcon, labelKey: "editor.import", onClick: props.onShowImport } as const]),
    { icon: DownloadIcon, labelKey: "editor.export", onClick: props.onShowExport },
    ...(!props.viewOnly && props.onShowConvertTypes
      ? [{ icon: SwapHorizontalIcon, labelKey: "editor.convertTypes", onClick: props.onShowConvertTypes } as const]
      : []),
    { icon: ClockIcon, labelKey: "editor.history", onClick: props.onShowHistory },
    { icon: LayersIcon, labelKey: "editor.compare", onClick: props.onShowCompare },
  ]);

  const historyActions = $derived<ToolbarAction[]>(
    props.viewOnly
      ? []
      : [
          { icon: UndoIcon, labelKey: "editor.undo", onClick: props.onUndo },
          { icon: RedoIcon, labelKey: "editor.redo", onClick: props.onRedo },
          { icon: LayoutGridIcon, labelKey: "editor.autoLayout", onClick: props.onAutoLayout },
        ],
  );

  /**
   * Live-sync state, shown only when it isn't the boring one: a dropped socket
   * has to be visible, since edits made while it's down reach nobody else until
   * the reconnect lands.
   */
  const showConnection = $derived(!(props.connection === "connected" && props.synced));
  const reconnecting = $derived(props.connection === "reconnecting" || props.connection === "closed");
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

      {#if props.onShowDeploy && !props.viewOnly && props.isProjectAdmin}
        <Button size="sm" variant="primary" onclick={props.onShowDeploy}>
          <Icon icon={SparklesIcon} size={13} />
          <span class="hidden sm:inline">{t("deployment.deploy")}</span>
        </Button>
      {/if}
    </div>

    <span class={`${DIVIDER_CLASS} hidden md:block`}></span>

    {#if showConnection}
      <span class="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-text-muted">
        <span
          class={`h-[7px] w-[7px] shrink-0 rounded-full ${
            reconnecting ? "bg-danger shadow-[0_0_0_3px_var(--color-danger-light)]" : "bg-text-muted"
          }`}
        ></span>
        {t(reconnecting ? "editor.reconnecting" : "editor.connecting")}
      </span>
    {/if}

    <PresenceList localName={props.localUser} localColor={props.localColor} remote={props.remoteAwareness} />

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
