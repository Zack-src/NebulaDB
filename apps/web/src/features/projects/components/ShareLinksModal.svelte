<script lang="ts" module>
  /** Offered lifetimes, in days. The server refuses more than a year and has no "never". */
  const EXPIRY_DAYS = [7, 30, 90, 365] as const;
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
  import Select from "@/components/ui/Select.svelte";
  import { INPUT_CLASS } from "@/components/ui/inputStyles";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { SHARE_CONTENT_KEY, SHARE_STATUS_KEY, SHARE_STATUS_TONE, shareLinkFacts } from "@/features/share/shareLinkLabels";
  import {
    createShareLink,
    fetchShareLinks,
    revokeShareLink,
    shareUrl,
    type ShareContent,
  } from "@/services/shareLinksApi";
  import type { ProjectSummary } from "@/types";
  import { copyText } from "@/utils/clipboard";

  /**
   * A project's read-only share links — administrators only (the server
   * enforces it; the card only offers the button to them). The link's address
   * holds its token, which the server keeps only hashed: it is shown once,
   * right after creation, and never again.
   */
  let { project, onClose }: { project: ProjectSummary; onClose: () => void } = $props();

  const { t } = useTranslation();
  const links = useAsyncResource(() => fetchShareLinks(project.id));

  let label = $state("");
  let shows = $state<ShareContent>("both");
  let expiresInDays = $state<number>(30);
  let newUrl = $state<string | null>(null);
  let copied = $state(false);

  const create = useAsyncAction(async () => {
    const created = await createShareLink(project.id, { label: label.trim(), shows, expiresInDays });
    newUrl = shareUrl(created.token);
    copied = false;
    label = "";
    links.reload();
  });
  const revoke = useAsyncAction(async (id: string) => {
    await revokeShareLink(project.id, id);
    links.reload();
  });

  const enabled = $derived(links.data?.enabled ?? false);
  const error = $derived(links.error ?? create.error ?? revoke.error);

  function copyUrl() {
    if (!newUrl) return;
    void copyText(newUrl).then((ok) => (copied = ok));
  }
</script>

<Modal title={t("shareLinks.title", { name: project.name })} wide {onClose}>
  <Hint>{t("shareLinks.hint")}</Hint>

  {#if links.data && !enabled}
    <p class="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs" role="status">
      {t("shareLinks.disabledOnInstance")}
    </p>
  {/if}

  <form
    class="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-border p-3"
    onsubmit={(event) => {
      event.preventDefault();
      if (label.trim()) void create.run();
    }}
  >
    <input
      class={`${INPUT_CLASS} min-w-[200px] flex-1`}
      placeholder={t("shareLinks.labelPlaceholder")}
      aria-label={t("shareLinks.label")}
      maxlength={100}
      disabled={!enabled}
      bind:value={label}
    />
    <Select
      class="w-44"
      bind:value={shows}
      disabled={!enabled}
      options={(["both", "diagram", "dictionary"] as const).map((value) => ({
        value,
        label: t(SHARE_CONTENT_KEY[value]),
      }))}
      aria-label={t("shareLinks.showsLabel")}
    />
    <Select
      class="w-36"
      bind:value={expiresInDays}
      disabled={!enabled}
      options={EXPIRY_DAYS.map((days) => ({ value: days, label: t("shareLinks.expiresIn", { count: days }) }))}
      aria-label={t("shareLinks.expiryLabel")}
    />
    <Button variant="primary" size="sm" type="submit" disabled={!enabled || create.pending || !label.trim()}>
      <Icon icon={PlusIcon} size={12} />
      {t("shareLinks.create")}
    </Button>
  </form>

  {#if newUrl}
    <div class="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs" role="status">
      <p class="mb-2 font-semibold">{t("shareLinks.urlOnce")}</p>
      <div class="flex items-center gap-2">
        <code
          class="flex-1 overflow-x-auto break-all rounded bg-surface px-2 py-1 font-mono text-[11px]"
          data-testid="share-link-url">{newUrl}</code
        >
        <Button size="sm" onclick={copyUrl}>{copied ? t("common.copied") : t("common.copy")}</Button>
      </div>
    </div>
  {/if}

  {#if error}<ErrorText>{error}</ErrorText>{/if}

  <div class="mt-4">
    {#if !links.data || links.data.links.length === 0}
      <EmptyState>{links.loading ? t("common.loading") : t("shareLinks.empty")}</EmptyState>
    {:else}
      <List>
        {#each links.data.links as link (link.id)}
          <ListRow>
            <ListMain>
              <span class="truncate text-xs font-semibold text-text">{link.label}</span>
              <code class="text-[11px] text-text-muted">{link.tokenPrefix}…</code>
              <Badge tone="muted">{t(SHARE_CONTENT_KEY[link.shows])}</Badge>
              {#if link.status !== "active"}
                <Badge tone={SHARE_STATUS_TONE[link.status]}>{t(SHARE_STATUS_KEY[link.status])}</Badge>
              {/if}
            </ListMain>
            <span class="text-[11px] text-text-muted">{shareLinkFacts(link, t, i18n.locale)}</span>
            {#if link.status === "active"}
              <Button
                variant="ghost"
                size="icon"
                data-tooltip={t("shareLinks.revoke")}
                aria-label={t("shareLinks.revokeNamed", { label: link.label })}
                disabled={revoke.pending}
                onclick={() => void revoke.run(link.id)}
              >
                <Icon icon={TrashIcon} size={13} />
              </Button>
            {/if}
          </ListRow>
        {/each}
      </List>
    {/if}
  </div>
</Modal>
