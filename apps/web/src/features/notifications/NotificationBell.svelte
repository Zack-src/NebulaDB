<script lang="ts" module>
  /** How often the inbox is read again while the app is open. A notification is not a chat message: a minute is soon enough. */
  const POLL_MS = 60_000;
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import type { UserNotification } from "@athanordb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { CommentIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import Popover from "@/components/ui/Popover.svelte";
  import { inboxPush } from "@/features/notifications/inboxPush.svelte";
  import { parseServerTime } from "@/features/sql/format";
  import { formatRelativeTime } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { fetchInbox, markNotificationsRead, type Inbox } from "@/services/notificationsApi";

  /**
   * The notification centre: what happened on the projects this account
   * follows, newest first, with the count of what it has not read yet.
   * Opening a notification marks it read and goes to its project.
   */
  let {
    onOpenProject,
  }: {
    /** Absent where there is nowhere to go from (the entry is then only marked read). */
    onOpenProject?: (projectId: string) => void;
  } = $props();

  const { t } = useTranslation();
  let inbox = $state.raw<Inbox>({ notifications: [], unread: 0 });
  let open = $state(false);
  let anchor: HTMLSpanElement | undefined = $state();

  const refresh = () =>
    fetchInbox()
      .then((next) => (inbox = next))
      // Offline, signed out meanwhile, or the perf harness: an empty bell is better than a broken header.
      .catch(() => {});
  $effect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  });
  // An open project's socket says so the moment a notification arrives; the
  // poll above remains for everywhere else (the dashboard, other projects).
  let seenPush = untrack(() => inboxPush.count);
  $effect(() => {
    if (inboxPush.count !== seenPush) {
      seenPush = inboxPush.count;
      void refresh();
    }
  });

  /** One line saying what happened, from the event and its facts. */
  function describe(notification: UserNotification): string {
    const { event, params } = notification;
    const values = Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value ?? "")]));
    switch (event) {
      case "deployment":
        return t(
          params.kind === "rollback"
            ? params.success
              ? "notifications.rollback.success"
              : "notifications.rollback.failure"
            : params.success
              ? "notifications.deployment.success"
              : "notifications.deployment.failure",
          values,
        );
      case "lock":
        return t(params.locked ? "notifications.lock.placed" : "notifications.lock.lifted", values);
      case "seed":
        return t(params.removed ? "notifications.seed.removed" : "notifications.seed.set", values);
      case "mention":
      case "reply":
        return t(`notifications.${event}.${params.column ? "column" : "table"}`, values);
      default:
        return t(params.kind === "accounts" ? "notifications.driftAccounts" : "notifications.drift", values);
    }
  }

  async function openNotification(notification: UserNotification) {
    if (!notification.read) inbox = await markNotificationsRead([notification.id]).catch(() => inbox);
    if (notification.projectId && onOpenProject) {
      open = false;
      onOpenProject(notification.projectId);
    }
  }
  const markAll = async () => (inbox = await markNotificationsRead().catch(() => inbox));
</script>

<span bind:this={anchor} class="relative inline-flex">
  <Button
    variant="ghost"
    size="icon-sm"
    active={open}
    onclick={() => {
      open = !open;
      if (open) void refresh();
    }}
    data-tooltip={t("notifications.title")}
    data-tooltip-pos="bottom"
    aria-label={inbox.unread > 0 ? t("notifications.unread", { count: inbox.unread }) : t("notifications.title")}
    aria-haspopup="dialog"
    aria-expanded={open}
  >
    <Icon icon={CommentIcon} size={15} />
  </Button>
  {#if inbox.unread > 0}
    <span
      class="pointer-events-none absolute -right-0.5 -top-0.5 min-w-[15px] rounded-full bg-danger px-1 text-center text-[9px] font-bold leading-[15px] text-white"
      data-testid="notification-count"
    >
      {inbox.unread > 99 ? "99+" : inbox.unread}
    </span>
  {/if}
</span>

<Popover {open} {anchor} onClose={() => (open = false)} class="w-[340px] p-0" role="dialog" aria-label={t("notifications.title")}>
  <div class="flex items-center gap-2 border-b border-border px-3 py-2">
    <h2 class="m-0 flex-1 text-body-sm font-semibold text-text">{t("notifications.title")}</h2>
    {#if inbox.unread > 0}
      <Button size="xs" variant="ghost" onclick={() => void markAll()}>{t("notifications.markAllRead")}</Button>
    {/if}
  </div>
  {#if inbox.notifications.length === 0}
    <p class="m-0 px-3 py-6 text-center text-xs text-text-muted">{t("notifications.empty")}</p>
  {:else}
    <ul class="m-0 max-h-[360px] list-none overflow-y-auto p-0" aria-label={t("notifications.title")}>
      {#each inbox.notifications as notification (notification.id)}
        <li class="border-b border-border last:border-b-0" data-event={notification.event} data-read={notification.read}>
          <button
            type="button"
            class="flex w-full cursor-pointer flex-col gap-0.5 border-0 bg-transparent px-3 py-2 text-left text-xs hover:bg-surface-hover"
            onclick={() => void openNotification(notification)}
          >
            <span class={notification.read ? "text-text-secondary" : "font-semibold text-text"}>
              {describe(notification)}
            </span>
            <span class="text-text-muted">
              {notification.projectName ?? t("notifications.projectGone")} ·
              {formatRelativeTime(parseServerTime(notification.createdAt), i18n.locale)}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</Popover>
