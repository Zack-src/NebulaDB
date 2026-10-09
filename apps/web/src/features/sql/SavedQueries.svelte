<script lang="ts">
  import type { DbSavedQuery } from "@nebuladb/shared";
  import ConfirmDialog from "@/components/overlays/ConfirmDialog.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import Input from "@/components/ui/Input.svelte";
  import { LABEL_CLASS } from "@/components/ui/inputStyles";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { deleteSavedQuery, updateSavedQuery } from "@/services/dbAdminApi";

  /**
   * The saved queries of the connection: the person's own, then the ones
   * others shared (read-only, with their author). Opening one only puts its
   * text in the editor — running it is the console's usual run, with the
   * caller's own access.
   */
  let {
    connectionId,
    queries,
    loading,
    error,
    onOpen,
    onChanged,
  }: {
    connectionId: string;
    queries: DbSavedQuery[];
    loading: boolean;
    error: string | null;
    onOpen: (query: DbSavedQuery) => void;
    onChanged: () => void;
  } = $props();

  const { t } = useTranslation();
  let search = $state("");
  let renaming = $state.raw<DbSavedQuery | null>(null);
  let renamed = $state("");
  let deleting = $state.raw<DbSavedQuery | null>(null);

  const filtered = $derived.by(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return queries;
    return queries.filter((q) =>
      [q.name, q.description ?? "", q.sql, q.authorName].some((text) => text.toLowerCase().includes(needle)),
    );
  });
  const mine = $derived(filtered.filter((q) => q.mine));
  const others = $derived(filtered.filter((q) => !q.mine));

  const share = useAsyncAction(async (query: DbSavedQuery) => {
    await updateSavedQuery(connectionId, query.id, { shared: !query.shared });
    onChanged();
  });
  const rename = useAsyncAction(async (query: DbSavedQuery, name: string) => {
    await updateSavedQuery(connectionId, query.id, { name: name.trim() });
    onChanged();
  });
  const remove = useAsyncAction(async (query: DbSavedQuery) => {
    await deleteSavedQuery(connectionId, query.id);
    onChanged();
  });

  function startRename(query: DbSavedQuery) {
    rename.clearError();
    renamed = query.name;
    renaming = query;
  }

  function startDelete(query: DbSavedQuery) {
    remove.clearError();
    deleting = query;
  }
</script>

{#snippet row(query: DbSavedQuery)}
  <div class="flex items-center gap-1 rounded-sm px-2 py-1 text-xs hover:bg-surface-hover" data-testid="saved-query">
    <button
      type="button"
      class="flex min-w-0 flex-1 items-center gap-2 text-left"
      data-tooltip={query.description ?? undefined}
      onclick={() => onOpen(query)}
    >
      <span class="shrink-0 font-semibold text-text">{query.name}</span>
      {#if query.mine && query.shared}<Badge tone="admin">{t("dbadmin.sql.saved.shared")}</Badge>{/if}
      {#if !query.mine}<span class="shrink-0 text-text-muted"
          >{t("dbadmin.sql.saved.by", { name: query.authorName })}</span
        >{/if}
      <span class="min-w-0 flex-1 truncate font-mono text-text-muted">{query.sql}</span>
    </button>
    {#if query.mine}
      <Button
        variant="ghost"
        size="xs"
        disabled={share.pending}
        data-tooltip={query.shared ? undefined : t("dbadmin.sql.saved.shareHint")}
        onclick={() => void share.run(query)}
        >{query.shared ? t("dbadmin.sql.saved.unshare") : t("dbadmin.sql.saved.share")}</Button
      >
      <Button variant="ghost" size="xs" onclick={() => startRename(query)}>{t("common.rename")}</Button>
      <Button variant="danger-ghost" size="xs" onclick={() => startDelete(query)}>{t("common.delete")}</Button>
    {/if}
  </div>
{/snippet}

<div class="space-y-2">
  <Input
    inputSize="sm"
    type="search"
    bind:value={search}
    placeholder={t("dbadmin.sql.saved.search")}
    aria-label={t("dbadmin.sql.saved.search")}
    wrapperClassName="w-full max-w-xs"
  />
  {#if error}<ErrorText>{error}</ErrorText>{/if}
  {#if share.error}<ErrorText>{share.error}</ErrorText>{/if}
  {#if queries.length === 0}
    <Hint>{loading ? t("common.loading") : t("dbadmin.sql.saved.empty")}</Hint>
  {:else if filtered.length === 0}
    <Hint>{t("dbadmin.sql.saved.noMatch")}</Hint>
  {:else}
    <div class="max-h-56 space-y-1 overflow-y-auto">
      {#each mine as query (query.id)}{@render row(query)}{/each}
      {#if mine.length > 0 && others.length > 0}
        <div class="px-2 pt-1 text-[10px] font-bold uppercase text-text-muted">{t("dbadmin.sql.saved.sharedByOthers")}</div>
      {/if}
      {#each others as query (query.id)}{@render row(query)}{/each}
    </div>
  {/if}
</div>

{#if renaming}
  {@const target = renaming}
  <ConfirmDialog
    title={t("dbadmin.sql.saved.renameTitle")}
    confirmLabel={t("common.rename")}
    pending={rename.pending}
    error={rename.error}
    onCancel={() => (renaming = null)}
    onConfirm={async () => {
      if (renamed.trim() && (await rename.run(target, renamed))) renaming = null;
    }}
  >
      <label class="flex flex-col gap-1.5">
        <span class={LABEL_CLASS}>{t("dbadmin.sql.saved.name")}</span>
        <Input bind:value={renamed} autofocus maxlength={120} autocomplete="off" wrapperClassName="w-full" />
      </label>
  </ConfirmDialog>
{/if}
{#if deleting}
  {@const target = deleting}
  <ConfirmDialog
    title={t("dbadmin.sql.saved.deleteTitle")}
    message={target.shared
      ? t("dbadmin.sql.saved.deleteSharedMessage", { name: target.name })
      : t("dbadmin.sql.saved.deleteMessage", { name: target.name })}
    danger="danger"
    confirmLabel={t("common.delete")}
    pending={remove.pending}
    error={remove.error}
    onCancel={() => (deleting = null)}
    onConfirm={async () => {
      if (await remove.run(target)) deleting = null;
    }}
  />
{/if}
