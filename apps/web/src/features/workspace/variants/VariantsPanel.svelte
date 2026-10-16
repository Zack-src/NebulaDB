<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { CopyIcon, LayersIcon, SwapHorizontalIcon } from "@/components/icons/Icons";
  import ConfirmDialog from "@/components/overlays/ConfirmDialog.svelte";
  import Modal from "@/components/overlays/Modal.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import Input from "@/components/ui/Input.svelte";
  import { formatDate } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { createVariant, detachVariant, fetchVariants, type VariantStatus } from "@/services/variantsApi";
  import type { ProjectSummary } from "@/types";
  import VariantCompareModal from "./VariantCompareModal.svelte";
  import VariantSyncModal from "./VariantSyncModal.svelte";

  /**
   * The "Variantes" tab. On an original: its client variants, how far each is
   * behind, sending changes to the chosen ones, comparing any two versions. On
   * a variant: its original, what it has not received yet, taking it, and
   * comparing with it.
   */
  let {
    project,
    onOpenProject,
  }: {
    project: ProjectSummary;
    onOpenProject?: (projectId: string) => void;
  } = $props();

  const { t } = useTranslation();
  const info = useAsyncResource(() => fetchVariants(project.id));
  const isAdmin = $derived(project.permission === "administrator");

  let selected = $state<string[]>([]);
  let syncFor = $state<{ originalId: string; variantIds: string[] } | null>(null);
  let compare = $state<{ left: string; right: string } | null>(null);
  let creating = $state(false);
  let newName = $state("");
  let confirmDetach = $state(false);

  const variants = $derived(info.data?.variants ?? []);
  const original = $derived(info.data?.original ?? null);
  const behind = $derived(variants.filter((v) => v.status.pending > 0));
  const versions = $derived(
    original
      ? [
          { id: original.id, name: original.name ?? t("variants.original") },
          { id: project.id, name: project.name },
        ]
      : [{ id: project.id, name: project.name }, ...variants.map((v) => ({ id: v.id, name: v.name }))],
  );

  const create = useAsyncAction(async () => {
    await createVariant(project.id, newName.trim());
    creating = false;
    newName = "";
    info.reload();
  });

  const detach = useAsyncAction(async () => {
    await detachVariant(project.id);
    confirmDetach = false;
    info.reload();
  });

  function statusText(status: VariantStatus): string {
    if (status.pending === 0) return t("variants.status.upToDate");
    return t("variants.status.behind", { count: status.pending });
  }
</script>

{#snippet statusBadges(status: VariantStatus)}
  <Badge tone={status.pending === 0 ? "success" : "warning"}>{statusText(status)}</Badge>
  {#if status.conflicts > 0}
    <Badge tone="danger">{t("variants.status.conflicts", { count: status.conflicts })}</Badge>
  {/if}
  {#if status.customizations > 0}
    <Badge tone="muted">{t("variants.status.customizations", { count: status.customizations })}</Badge>
  {/if}
{/snippet}

<div class="min-h-0 flex-1 overflow-y-auto bg-bg" data-testid="variants">
  <div class="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-6">
    <div class="flex flex-wrap items-center gap-3">
      <h2 class="m-0 flex-1 text-heading font-semibold text-text">{t("variants.title")}</h2>
      {#if !original && info.data}
        <Button size="sm" variant="primary" onclick={() => (creating = true)}>
          <Icon icon={CopyIcon} size={12} />
          {t("variants.create")}
        </Button>
      {/if}
    </div>

    {#if info.error}<ErrorText>{info.error}</ErrorText>{/if}

    {#if original}
      <!-- This project is a client variant. -->
      <section class="space-y-3 rounded-md border border-border bg-surface p-4" data-testid="variant-original">
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <Icon icon={LayersIcon} size={14} class="text-primary" />
          <span>{t("variants.isVariantOf")}</span>
          {#if original.canView}
            <button
              class="cursor-pointer border-0 bg-transparent p-0 text-sm font-semibold text-primary hover:underline"
              onclick={() => onOpenProject?.(original.id)}>{original.name}</button
            >
          {:else}
            <span class="text-text-muted">{t("variants.originalHidden")}</span>
          {/if}
        </div>
        {#if original.status}
          <div class="flex flex-wrap gap-1.5">{@render statusBadges(original.status)}</div>
        {/if}
        <p class="m-0 text-xs text-text-muted">
          {t("variants.lastSync", {
            date: formatDate(original.syncedAt, i18n.locale),
            who: original.syncedByName ?? "—",
          })}
        </p>
        <div class="flex flex-wrap gap-2">
          {#if original.canView}
            <Button size="sm" variant="outline" onclick={() => (compare = { left: original.id, right: project.id })}>
              <Icon icon={SwapHorizontalIcon} size={12} />
              {t("variants.compareWithOriginal")}
            </Button>
            {#if (original.status?.pending ?? 0) > 0 && project.permission !== "view"}
              <Button
                size="sm"
                variant="primary"
                onclick={() => (syncFor = { originalId: original.id, variantIds: [project.id] })}
              >
                {t("variants.takeChanges", { count: original.status?.pending ?? 0 })}
              </Button>
            {/if}
          {/if}
          {#if isAdmin}
            <Button size="sm" variant="ghost" onclick={() => (confirmDetach = true)}>{t("variants.detach")}</Button>
          {/if}
        </div>
        {#if detach.error}<ErrorText>{detach.error}</ErrorText>{/if}
      </section>
    {:else if info.data}
      <Hint>{t("variants.hint")}</Hint>
      {#if variants.length === 0}
        <p class="m-0 rounded-md border border-dashed border-border p-6 text-center text-xs text-text-muted">
          {t("variants.none")}
        </p>
      {:else}
        <div class="flex flex-wrap items-center gap-2">
          <Checkbox
            checked={selected.length === variants.length}
            onChange={(checked) => (selected = checked ? variants.map((v) => v.id) : [])}
          >
            <span class="text-xs">{t("variants.selectAll")}</span>
          </Checkbox>
          {#if behind.length > 0}
            <Button size="xs" variant="ghost" onclick={() => (selected = behind.map((v) => v.id))}>
              {t("variants.selectBehind", { count: behind.length })}
            </Button>
          {/if}
          <span class="flex-1"></span>
          <Button
            size="sm"
            variant="primary"
            disabled={selected.length === 0}
            onclick={() => (syncFor = { originalId: project.id, variantIds: [...selected] })}
          >
            {t("variants.send", { count: selected.length })}
          </Button>
        </div>
        <ul class="m-0 list-none space-y-2 p-0">
          {#each variants as variant (variant.id)}
            <li class="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2" data-testid="variant-row">
              <Checkbox
                checked={selected.includes(variant.id)}
                onChange={(checked) =>
                  (selected = checked ? [...selected, variant.id] : selected.filter((id) => id !== variant.id))}
              >
                <span class="text-sm font-semibold">{variant.name}</span>
              </Checkbox>
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <div class="flex flex-wrap gap-1.5">{@render statusBadges(variant.status)}</div>
                <span class="text-[11px] text-text-muted">
                  {t("variants.lastSync", { date: formatDate(variant.syncedAt, i18n.locale), who: variant.syncedByName ?? "—" })}
                </span>
              </div>
              <div class="flex shrink-0 gap-1">
                <Button size="xs" variant="ghost" onclick={() => (compare = { left: project.id, right: variant.id })}>
                  {t("variants.compare.button")}
                </Button>
                <Button size="xs" variant="ghost" onclick={() => onOpenProject?.(variant.id)}>{t("variants.open")}</Button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
</div>

{#if creating}
  <Modal title={t("variants.create")} onClose={() => (creating = false)} dismissable={!create.pending}>
    <form
      class="space-y-3"
      onsubmit={(event) => {
        event.preventDefault();
        if (newName.trim()) void create.run();
      }}
    >
      <Hint>{t("variants.createHint")}</Hint>
      <Input
        wrapperClassName="w-full"
        bind:value={newName}
        aria-label={t("variants.createName")}
        placeholder={t("variants.createPlaceholder", { name: project.name })}
        autofocus
      />
      {#if create.error}<ErrorText>{create.error}</ErrorText>{/if}
      <div class="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onclick={() => (creating = false)} disabled={create.pending}>{t("common.cancel")}</Button>
        <Button size="sm" variant="primary" type="submit" disabled={create.pending || !newName.trim()}>
          {create.pending ? t("common.saving") : t("common.create")}
        </Button>
      </div>
    </form>
  </Modal>
{/if}

{#if syncFor}
  <VariantSyncModal
    originalId={syncFor.originalId}
    variantIds={syncFor.variantIds}
    onClose={() => (syncFor = null)}
    onDone={() => {
      selected = [];
      info.reload();
    }}
  />
{/if}

{#if compare}
  <VariantCompareModal {versions} initialLeft={compare.left} initialRight={compare.right} onClose={() => (compare = null)} />
{/if}

{#if confirmDetach}
  <ConfirmDialog
    title={t("variants.detachTitle")}
    message={t("variants.detachMessage")}
    danger="warning"
    confirmLabel={t("variants.detach")}
    onCancel={() => (confirmDetach = false)}
    onConfirm={() => void detach.run()}
  />
{/if}
