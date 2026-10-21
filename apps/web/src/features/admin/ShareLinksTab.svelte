<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { TrashIcon } from "@/components/icons/Icons";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import List from "@/components/ui/List.svelte";
  import ListMain from "@/components/ui/ListMain.svelte";
  import ListRow from "@/components/ui/ListRow.svelte";
  import { SHARE_CONTENT_KEY, SHARE_STATUS_KEY, SHARE_STATUS_TONE, shareLinkFacts } from "@/features/share/shareLinkLabels";
  import SettingSwitch from "@/features/settings/SettingSwitch.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { fetchAllShareLinks, revokeAnyShareLink, setShareLinksEnabled } from "@/services/shareLinksApi";

  /**
   * Admin → Liens de partage: whether the instance allows read-only links to a
   * project at all (off by default; off stops every existing link without
   * deleting it), and every link of every project, to revoke any of them.
   * Both changes are immediate and audited server-side.
   */
  const { t } = useTranslation();
  const links = useAsyncResource(fetchAllShareLinks);

  const toggle = useAsyncAction(async (enabled: boolean) => {
    await setShareLinksEnabled(enabled);
    links.reload();
  });
  const revoke = useAsyncAction(async (id: string) => {
    await revokeAnyShareLink(id);
    links.reload();
  });

  const error = $derived(links.error ?? toggle.error ?? revoke.error);
</script>

<div>
  <h2 class="mb-4 text-lg font-semibold">{t("admin.section.shareLinks")}</h2>
  <div class="mb-4 max-w-[640px]">
    <SettingSwitch
      label={t("shareLinks.admin.enabled")}
      hint={t("shareLinks.admin.enabledHint")}
      checked={links.data?.enabled ?? false}
      onChange={(enabled) => void toggle.run(enabled)}
    />
  </div>
  {#if error}<ErrorText>{error}</ErrorText>{/if}

  {#if !links.data || links.data.links.length === 0}
    <EmptyState>{links.loading ? t("common.loading") : t("shareLinks.admin.empty")}</EmptyState>
  {:else}
    <List>
      {#each links.data.links as link (link.id)}
        <ListRow>
          <ListMain>
            <span class="truncate text-xs font-semibold text-text">{link.projectName}</span>
            <span class="truncate text-xs text-text-secondary">{link.label}</span>
            <code class="text-[11px] text-text-muted">{link.tokenPrefix}…</code>
            <Badge tone="muted">{t(SHARE_CONTENT_KEY[link.shows])}</Badge>
            <Badge tone={SHARE_STATUS_TONE[link.status]}>{t(SHARE_STATUS_KEY[link.status])}</Badge>
          </ListMain>
          <span class="text-[11px] text-text-muted">
            {link.createdByName ? `${link.createdByName} · ` : ""}{shareLinkFacts(link, t, i18n.locale)}
          </span>
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
