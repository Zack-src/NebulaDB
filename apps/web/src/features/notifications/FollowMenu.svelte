<script lang="ts">
  import { NOTIFICATION_EVENTS, type NotificationEvent } from "@nebuladb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { EyeIcon, EyeOffIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import Menu from "@/components/ui/Menu.svelte";
  import MenuItem from "@/components/ui/MenuItem.svelte";
  import { toast } from "@/components/ui/toast.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { describeApiError } from "@/i18n/serverErrorMessages";
  import { fetchProjectSubscription, saveProjectSubscription } from "@/services/notificationsApi";

  /**
   * "Suivre": which of the project's events this account wants to be told
   * about. Each tick is saved at once; unticking the last one stops following.
   * Deployments are listed for everyone but only reach project
   * administrators — the server decides that when the event happens.
   */
  let { projectId }: { projectId: string } = $props();

  const { t } = useTranslation();
  let events = $state.raw<readonly NotificationEvent[]>([]);
  $effect(() => {
    const id = projectId;
    events = [];
    fetchProjectSubscription(id)
      .then((subscription) => {
        if (id === projectId) events = subscription?.events ?? [];
      })
      // Offline or the perf harness: "not following" is the honest default.
      .catch(() => {});
  });

  async function toggle(event: NotificationEvent) {
    const wanted = events.includes(event) ? events.filter((other) => other !== event) : [...events, event];
    try {
      events = (await saveProjectSubscription(projectId, [...wanted]))?.events ?? [];
    } catch (err) {
      toast.error(describeApiError(err, t));
    }
  }
  const following = $derived(events.length > 0);
</script>

<Menu aria-label={t("follow.title")}>
  {#snippet trigger(props)}
    <Button
      {...props}
      variant="ghost"
      size="icon-sm"
      active={following}
      data-tooltip={following ? t("follow.following", { count: events.length }) : t("follow.title")}
      data-tooltip-pos="bottom"
      aria-label={following ? t("follow.following", { count: events.length }) : t("follow.title")}
    >
      <Icon icon={following ? EyeIcon : EyeOffIcon} size={15} />
    </Button>
  {/snippet}
  {#each NOTIFICATION_EVENTS as event (event)}
    <MenuItem checked={events.includes(event)} keepOpen onSelect={() => void toggle(event)}>
      {t(`follow.event.${event}`)}
    </MenuItem>
  {/each}
</Menu>
