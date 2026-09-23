<script lang="ts" module>
  import type { TranslationKeyOf } from "@/types";
  import type { WebhookDelivery, WebhookEvent, WebhookFormat } from "@/services/webhooksApi";

  const FORMATS: { id: WebhookFormat; labelKey: TranslationKeyOf }[] = [
    { id: "json", labelKey: "webhooks.format.json" },
    { id: "slack", labelKey: "webhooks.format.slack" },
    { id: "discord", labelKey: "webhooks.format.discord" },
  ];
  const EVENTS: { id: WebhookEvent; labelKey: TranslationKeyOf }[] = [
    { id: "schema.changed", labelKey: "webhooks.event.schemaChanged" },
    { id: "deployment.completed", labelKey: "webhooks.event.deploymentCompleted" },
  ];
  const STATUS_TONE = { succeeded: "success", failed: "danger", pending: "warning" } as const;
  const STATUS_KEY = {
    succeeded: "webhooks.delivery.succeeded",
    failed: "webhooks.delivery.failed",
    pending: "webhooks.delivery.pending",
  } as const satisfies Record<WebhookDelivery["status"], TranslationKeyOf>;

  /** Host + path — enough to recognise an endpoint; the query string often carries a token. */
  function shortUrl(raw: string): string {
    try {
      const url = new URL(raw);
      return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
    } catch {
      return raw;
    }
  }
</script>

<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { PlusIcon, TrashIcon } from "@/components/icons/Icons";
  import Modal from "@/components/overlays/Modal.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import List from "@/components/ui/List.svelte";
  import ListMain from "@/components/ui/ListMain.svelte";
  import ListRow from "@/components/ui/ListRow.svelte";
  import { CHECKBOX_CLASS, INPUT_CLASS, SELECT_CLASS } from "@/components/ui/inputStyles";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatDateTime } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import {
    createWebhook,
    deleteWebhook,
    fetchWebhookDeliveries,
    fetchWebhooks,
    setWebhookEnabled,
    testWebhook,
  } from "@/services/webhooksApi";
  import type { ProjectSummary } from "@/types";
  import { copyText } from "@/utils/clipboard";

  /**
   * A project's outgoing webhooks — administrators only (the server enforces
   * it; the card only offers this button to them). The signing secret is
   * shown once, right after creation, and never again.
   */
  let { project, onClose }: { project: ProjectSummary; onClose: () => void } = $props();

  const { t } = useTranslation();
  const webhooks = useAsyncResource(() => fetchWebhooks(project.id));

  let url = $state("");
  let format = $state<WebhookFormat>("slack");
  let events = $state<Record<WebhookEvent, boolean>>({ "schema.changed": true, "deployment.completed": true });
  let newSecret = $state<string | null>(null);
  let secretCopied = $state(false);
  /** Last "send a test" outcome per webhook id. */
  let testResults = $state<Record<string, WebhookDelivery>>({});
  let openLog = $state<string | null>(null);
  let log = $state.raw<WebhookDelivery[]>([]);

  const selectedEvents = $derived((Object.keys(events) as WebhookEvent[]).filter((e) => events[e]));

  const create = useAsyncAction(async () => {
    const created = await createWebhook(project.id, { url: url.trim(), format, events: selectedEvents });
    newSecret = created.secret;
    secretCopied = false;
    url = "";
    webhooks.reload();
  });
  const toggle = useAsyncAction(async (id: string, enabled: boolean) => {
    await setWebhookEnabled(project.id, id, enabled);
    webhooks.reload();
  });
  const remove = useAsyncAction(async (id: string) => {
    await deleteWebhook(project.id, id);
    if (openLog === id) openLog = null;
    webhooks.reload();
  });
  const test = useAsyncAction(async (id: string) => {
    testResults = { ...testResults, [id]: await testWebhook(project.id, id) };
    if (openLog === id) log = await fetchWebhookDeliveries(project.id, id);
  });
  const showLog = useAsyncAction(async (id: string) => {
    if (openLog === id) {
      openLog = null;
      return;
    }
    log = await fetchWebhookDeliveries(project.id, id);
    openLog = id;
  });

  const error = $derived(
    webhooks.error ?? create.error ?? toggle.error ?? remove.error ?? test.error ?? showLog.error,
  );

  function copySecret() {
    if (!newSecret) return;
    void copyText(newSecret).then((ok) => (secretCopied = ok));
  }
</script>

<Modal title={t("webhooks.title", { name: project.name })} wide {onClose}>
  <Hint>{t("webhooks.hint")}</Hint>

  <form
    class="mt-3 flex flex-col gap-2 rounded-md border border-border p-3"
    onsubmit={(event) => {
      event.preventDefault();
      if (url.trim() && selectedEvents.length > 0) void create.run();
    }}
  >
    <div class="flex flex-wrap items-center gap-2">
      <input
        class={`${INPUT_CLASS} min-w-[240px] flex-1`}
        type="url"
        placeholder="https://hooks.slack.com/services/…"
        aria-label={t("webhooks.url")}
        bind:value={url}
      />
      <select class={SELECT_CLASS} bind:value={format} aria-label={t("webhooks.formatLabel")}>
        {#each FORMATS as option (option.id)}
          <option value={option.id}>{t(option.labelKey)}</option>
        {/each}
      </select>
    </div>
    <div class="flex flex-wrap items-center gap-4 text-xs">
      {#each EVENTS as option (option.id)}
        <label class="flex items-center gap-1.5">
          <input type="checkbox" class={CHECKBOX_CLASS} bind:checked={events[option.id]} />
          {t(option.labelKey)}
        </label>
      {/each}
      <Button
        variant="primary"
        size="sm"
        type="submit"
        class="ml-auto"
        disabled={create.pending || !url.trim() || selectedEvents.length === 0}
      >
        <Icon icon={PlusIcon} size={12} />
        {t("webhooks.add")}
      </Button>
    </div>
  </form>

  {#if newSecret}
    <div class="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs" role="status">
      <p class="mb-2 font-semibold">{t("webhooks.secretOnce")}</p>
      <div class="flex items-center gap-2">
        <code class="flex-1 overflow-x-auto rounded bg-surface px-2 py-1 font-mono text-[11px]" data-testid="webhook-secret"
          >{newSecret}</code
        >
        <Button size="sm" onclick={copySecret}>{secretCopied ? t("common.copied") : t("common.copy")}</Button>
      </div>
    </div>
  {/if}

  {#if error}<ErrorText>{error}</ErrorText>{/if}

  <div class="mt-4">
    {#if !webhooks.data || webhooks.data.length === 0}
      <EmptyState>{webhooks.loading ? t("common.loading") : t("webhooks.empty")}</EmptyState>
    {:else}
      <List>
        {#each webhooks.data as hook (hook.id)}
          {@const result = testResults[hook.id]}
          <ListRow>
            <ListMain>
              <span class="font-mono text-xs" title={hook.url}>{shortUrl(hook.url)}</span>
              <Badge tone="muted">{hook.format}</Badge>
              {#if !hook.enabled}<Badge tone="danger">{t("webhooks.disabled")}</Badge>{/if}
            </ListMain>
            {#if result}
              <Badge tone={STATUS_TONE[result.status]}>
                {result.status === "succeeded" ? t(STATUS_KEY.succeeded) : (result.error ?? t(STATUS_KEY[result.status]))}
              </Badge>
            {/if}
            <Button size="sm" onclick={() => void test.run(hook.id)} disabled={test.pending}>{t("webhooks.test")}</Button>
            <Button size="sm" variant="ghost" onclick={() => void showLog.run(hook.id)}>{t("webhooks.log")}</Button>
            <label class="flex items-center gap-1 text-[11px] text-text-muted">
              <input
                type="checkbox"
                class={CHECKBOX_CLASS}
                checked={hook.enabled}
                onchange={(event) => void toggle.run(hook.id, event.currentTarget.checked)}
              />
              {t("webhooks.enabled")}
            </label>
            <Button
              variant="ghost"
              size="icon"
              data-tooltip={t("webhooks.delete")}
              aria-label={t("webhooks.delete")}
              onclick={() => void remove.run(hook.id)}
            >
              <Icon icon={TrashIcon} size={13} />
            </Button>
          </ListRow>
          {#if hook.disabledReason}
            <p class="-mt-1 mb-2 px-3 text-[11px] text-danger">{hook.disabledReason}</p>
          {/if}
          {#if openLog === hook.id}
            <div class="mb-2 rounded-md border border-border px-3 py-2">
              {#if log.length === 0}
                <p class="text-[11px] text-text-muted">{t("webhooks.logEmpty")}</p>
              {:else}
                <ul class="list-none">
                  {#each log as delivery (delivery.id)}
                    <li class="flex items-center gap-2 py-0.5 text-[11px]">
                      <Badge tone={STATUS_TONE[delivery.status]}>{t(STATUS_KEY[delivery.status])}</Badge>
                      <span class="font-mono">{delivery.event}</span>
                      <span class="text-text-muted">{formatDateTime(delivery.createdAt, i18n.locale)}</span>
                      {#if delivery.error}<span class="truncate text-danger">{delivery.error}</span>{/if}
                      {#if delivery.attempts > 1}
                        <span class="ml-auto text-text-muted">{t("webhooks.attempts", { count: delivery.attempts })}</span>
                      {/if}
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/if}
        {/each}
      </List>
    {/if}
  </div>
</Modal>
