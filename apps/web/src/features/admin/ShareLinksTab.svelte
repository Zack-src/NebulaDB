<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { CopyIcon, EyeIcon, LinkIcon, TrashIcon } from "@/components/icons/Icons";
  import AccountAvatar from "@/components/ui/AccountAvatar.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import List from "@/components/ui/List.svelte";
  import Switch from "@/components/ui/Switch.svelte";
  import { toast } from "@/components/ui/toast.svelte";
  import { SHARE_CONTENT_KEY, SHARE_STATUS_KEY, SHARE_STATUS_TONE, shareLinkFacts } from "@/features/share/shareLinkLabels";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatDate } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import {
    fetchAllShareLinks,
    revealShareLink,
    revokeAnyShareLink,
    setShareLinksEnabled,
    shareUrl,
    type InstanceShareLink,
  } from "@/services/shareLinksApi";
  import { copyText } from "@/utils/clipboard";

  /**
   * Admin → Liens de partage: whether the instance allows read-only links to a
   * project at all (off by default; off stops every existing link without
   * deleting it), and every link of every project — who made it, its full
   * address (shown and copied on request, each reveal audited) — to revoke any of them.
   * Both changes are immediate and audited server-side.
   */
  const { t } = useTranslation();
  const links = useAsyncResource(fetchAllShareLinks);

  /** Full addresses fetched so far, by link id; a link is only in here after someone asked for it. */
  let addresses = $state<Record<string, string>>({});
  let shown = $state<Record<string, boolean>>({});

  const toggle = useAsyncAction(async (enabled: boolean) => {
    await setShareLinksEnabled(enabled);
    links.reload();
  });
  const revoke = useAsyncAction(async (id: string) => {
    await revokeAnyShareLink(id);
    delete addresses[id];
    links.reload();
  });

  async function addressOf(link: InstanceShareLink): Promise<string> {
    return (addresses[link.id] ??= shareUrl((await revealShareLink(link.id)).token));
  }
  const reveal = useAsyncAction(async (link: InstanceShareLink) => {
    if (shown[link.id]) {
      shown[link.id] = false;
      return;
    }
    await addressOf(link);
    shown[link.id] = true;
  });
  const copy = useAsyncAction(async (link: InstanceShareLink) => {
    if (await copyText(await addressOf(link))) toast.success(t("shareLinks.admin.copied"));
  });

  const enabled = $derived(links.data?.enabled ?? false);
  const error = $derived(links.error ?? toggle.error ?? revoke.error ?? reveal.error ?? copy.error);
</script>

<div>
  <!-- Same width, radius and padding as the rows of the list below. -->
  <label
    class="mb-4 flex cursor-pointer items-center gap-3 rounded-sm border border-border bg-surface px-3 py-2.5 transition-colors hover:border-border-strong"
  >
    <Icon icon={LinkIcon} size={16} class="shrink-0 text-text-muted" />
    <span class="min-w-0 flex-1">
      <span class="block text-xs font-semibold text-text">{t("shareLinks.admin.enabled")}</span>
      <span class="block text-[11px] leading-normal text-text-muted">{t("shareLinks.admin.enabledHint")}</span>
    </span>
    <Switch size="sm" checked={enabled} disabled={!links.data || toggle.pending} onChange={(next) => void toggle.run(next)} />
  </label>
  {#if error}<ErrorText>{error}</ErrorText>{/if}

  {#if !links.data || links.data.links.length === 0}
    <EmptyState>{links.loading ? t("common.loading") : t("shareLinks.admin.empty")}</EmptyState>
  {:else}
    <List>
      {#each links.data.links as link (link.id)}
        <div
          class="flex flex-col gap-2 rounded-sm border border-border bg-surface px-3 py-2.5"
          class:opacity-70={link.status !== "active"}
          data-link={link.label}
        >
          <div class="flex items-center gap-2">
            <span class="min-w-0 flex-1 truncate">
              <span class="text-xs font-semibold text-text">{link.projectName}</span>
              <span class="text-xs text-text-secondary"> · {link.label}</span>
            </span>
            <Badge tone="muted">{t(SHARE_CONTENT_KEY[link.shows])}</Badge>
            {#if link.status !== "active"}
              <Badge tone={SHARE_STATUS_TONE[link.status]}>{t(SHARE_STATUS_KEY[link.status])}</Badge>
            {/if}
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
          </div>

          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
            <span class="flex items-center gap-1.5">
              {#if link.createdByName}
                <AccountAvatar name={link.createdByName} />
                <span class="font-semibold text-text-secondary">{link.createdByName}</span>
              {:else}
                <span class="italic">{t("shareLinks.admin.creatorGone")}</span>
              {/if}
              · {t("shareLinks.admin.createdOn", { date: formatDate(link.createdAt, i18n.locale) })}
            </span>
            <span>{shareLinkFacts(link, t, i18n.locale)}</span>
          </div>

          <div class="flex items-center gap-2">
            <code
              class="min-w-0 flex-1 select-all truncate rounded-sm border border-border bg-surface-raised px-2 py-1 font-mono text-[11px] text-text-secondary"
              aria-label={t("shareLinks.admin.address")}
            >
              {#if shown[link.id] && addresses[link.id]}
                {addresses[link.id]}
              {:else}
                {shareUrl(`${link.tokenPrefix}…`)}
              {/if}
            </code>
            {#if link.status === "active" && link.copyable}
              <Button
                size="sm"
                variant="ghost"
                aria-pressed={Boolean(shown[link.id])}
                disabled={reveal.pending}
                onclick={() => void reveal.run(link)}
              >
                <Icon icon={EyeIcon} size={13} />
                {shown[link.id] ? t("shareLinks.admin.hide") : t("shareLinks.admin.show")}
              </Button>
              <Button size="sm" variant="outline" disabled={copy.pending} onclick={() => void copy.run(link)}>
                <Icon icon={CopyIcon} size={13} />
                {t("shareLinks.admin.copy")}
              </Button>
            {:else if link.status === "active"}
              <span class="text-[11px] text-text-muted" data-tooltip={t("shareLinks.admin.notKeptHint")}>
                {t("shareLinks.admin.notKept")}
              </span>
            {/if}
          </div>
        </div>
      {/each}
    </List>
  {/if}
</div>
