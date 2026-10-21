<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import {
    ChevronRightIcon,
    CopyIcon,
    LayersIcon,
    PencilIcon,
    RestoreIcon,
    SwapHorizontalIcon,
    TrashIcon,
  } from "@/components/icons/Icons";
  import Menu from "@/components/ui/Menu.svelte";
  import MenuItem from "@/components/ui/MenuItem.svelte";
  import Select from "@/components/ui/Select.svelte";
  import { toast } from "@/components/ui/toast.svelte";
  import { renameProject, setProjectStatus } from "@/services/projectsApi";
  import { familyChanged } from "./familyState.svelte";
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
  import {
    createVariant,
    detachVariant,
    fetchFamily,
    fetchVariants,
    resetVariant,
    type VariantStatus,
  } from "@/services/variantsApi";
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
  // Every version one can see — what both sides of a comparison and "Copier depuis" choose among.
  const family = useAsyncResource(() => fetchFamily(project.id));
  const versions = $derived(
    family.data
      ? family.data.members.map((m) => ({ id: m.id, name: m.original ? `${m.name} — ${t("variants.original")}` : m.name }))
      : [{ id: project.id, name: project.name }],
  );
  /** The other variants of the same original: what a variant can be copied from. */
  const siblingsOf = (id: string) => (family.data?.members ?? []).filter((m) => !m.original && m.id !== id);

  function changed() {
    info.reload();
    family.reload();
    familyChanged();
  }

  const create = useAsyncAction(async () => {
    await createVariant(project.id, newName.trim());
    creating = false;
    newName = "";
    changed();
  });

  const detach = useAsyncAction(async () => {
    await detachVariant(project.id);
    confirmDetach = false;
    changed();
  });

  // ---- one variant's own actions: rename, put in the trash, reset on the original, copy another ----
  let renaming = $state<{ id: string; name: string } | null>(null);
  let trashing = $state<{ id: string; name: string } | null>(null);
  let resetting = $state<{ id: string; name: string } | null>(null);
  let copying = $state<{ id: string; name: string; from: string } | null>(null);

  const rename = useAsyncAction(async () => {
    if (!renaming) return;
    await renameProject(renaming.id, renaming.name.trim());
    renaming = null;
    changed();
  });
  const trash = useAsyncAction(async () => {
    if (!trashing) return;
    await setProjectStatus(trashing.id, "trashed");
    toast.success(t("variants.trashed", { name: trashing.name }));
    trashing = null;
    changed();
  });
  const reset = useAsyncAction(async (id: string, from: string) => {
    await resetVariant(id, from);
    toast.success(from === "original" ? t("variants.resetDone") : t("variants.copyDone"));
    resetting = null;
    copying = null;
    changed();
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
          {#if project.permission !== "view"}
            {#if original.canView}
              <Button size="sm" variant="ghost" onclick={() => (resetting = { id: project.id, name: project.name })}>
                <Icon icon={RestoreIcon} size={12} />
                {t("variants.reset")}
              </Button>
            {/if}
            {#if siblingsOf(project.id).length > 0}
              <Button
                size="sm"
                variant="ghost"
                onclick={() => (copying = { id: project.id, name: project.name, from: siblingsOf(project.id)[0].id })}
              >
                <Icon icon={CopyIcon} size={12} />
                {t("variants.copyFrom")}
              </Button>
            {/if}
          {/if}
          {#if isAdmin}
            <Button size="sm" variant="ghost" onclick={() => (confirmDetach = true)}>{t("variants.detach")}</Button>
          {/if}
        </div>
        {#if detach.error}<ErrorText>{detach.error}</ErrorText>{/if}
        {#if reset.error}<ErrorText>{reset.error}</ErrorText>{/if}
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
                <span class="text-caption text-text-muted">
                  {t("variants.lastSync", { date: formatDate(variant.syncedAt, i18n.locale), who: variant.syncedByName ?? "—" })}
                </span>
              </div>
              <div class="flex shrink-0 gap-1">
                <Button size="xs" variant="ghost" onclick={() => (compare = { left: project.id, right: variant.id })}>
                  {t("variants.compare.button")}
                </Button>
                <Button size="xs" variant="ghost" onclick={() => onOpenProject?.(variant.id)}>{t("variants.open")}</Button>
                {#if variant.canEdit || variant.canManage}
                  <Menu aria-label={t("variants.actionsFor", { name: variant.name })}>
                    {#snippet trigger(props)}
                      <Button {...props} size="xs" variant="ghost" aria-label={t("variants.actionsFor", { name: variant.name })}>
                        {t("variants.actions")}
                        <Icon icon={ChevronRightIcon} size={10} class="rotate-90" />
                      </Button>
                    {/snippet}
                    {#if variant.canManage}
                      <MenuItem icon={PencilIcon} onSelect={() => (renaming = { id: variant.id, name: variant.name })}>
                        {t("common.rename")}
                      </MenuItem>
                    {/if}
                    {#if variant.canEdit}
                      <MenuItem icon={RestoreIcon} onSelect={() => (resetting = { id: variant.id, name: variant.name })}>
                        {t("variants.reset")}
                      </MenuItem>
                      {#if siblingsOf(variant.id).length > 0}
                        <MenuItem
                          icon={CopyIcon}
                          onSelect={() => (copying = { id: variant.id, name: variant.name, from: siblingsOf(variant.id)[0].id })}
                        >
                          {t("variants.copyFrom")}
                        </MenuItem>
                      {/if}
                    {/if}
                    {#if variant.canManage}
                      <MenuItem icon={TrashIcon} danger onSelect={() => (trashing = { id: variant.id, name: variant.name })}>
                        {t("variants.trash")}
                      </MenuItem>
                    {/if}
                  </Menu>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
        {#if reset.error}<ErrorText>{reset.error}</ErrorText>{/if}
        {#if trash.error}<ErrorText>{trash.error}</ErrorText>{/if}
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

{#if renaming}
  <Modal title={t("variants.renameTitle")} onClose={() => (renaming = null)} narrow dismissable={!rename.pending}>
    <form
      class="space-y-3"
      onsubmit={(event) => {
        event.preventDefault();
        if (renaming?.name.trim()) void rename.run();
      }}
    >
      <Input wrapperClassName="w-full" bind:value={renaming.name} aria-label={t("variants.createName")} autofocus />
      {#if rename.error}<ErrorText>{rename.error}</ErrorText>{/if}
      <div class="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onclick={() => (renaming = null)} disabled={rename.pending}>{t("common.cancel")}</Button>
        <Button size="sm" variant="primary" type="submit" disabled={rename.pending || !renaming.name.trim()}>
          {rename.pending ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </form>
  </Modal>
{/if}

{#if trashing}
  <ConfirmDialog
    title={t("variants.trashTitle", { name: trashing.name })}
    message={t("variants.trashMessage")}
    danger="warning"
    confirmLabel={t("variants.trash")}
    onCancel={() => (trashing = null)}
    onConfirm={() => void trash.run()}
  />
{/if}

{#if resetting}
  <ConfirmDialog
    title={t("variants.resetTitle", { name: resetting.name })}
    message={t("variants.resetMessage")}
    danger="warning"
    confirmLabel={t("variants.reset")}
    onCancel={() => (resetting = null)}
    onConfirm={() => resetting && void reset.run(resetting.id, "original")}
  />
{/if}

{#if copying}
  <Modal title={t("variants.copyTitle", { name: copying.name })} onClose={() => (copying = null)} dismissable={!reset.pending}>
    <div class="space-y-3" data-testid="variant-copy">
      <div>
        <div id="copy-source" class="mb-1 text-xs font-medium text-text-muted">{t("variants.copySource")}</div>
        <Select
          class="w-full"
          aria-labelledby="copy-source"
          value={copying.from}
          options={siblingsOf(copying.id).map((m) => ({ value: m.id, label: m.name }))}
          onChange={(value) => copying && (copying.from = value)}
        />
      </div>
      <Hint>{t("variants.copyMessage")}</Hint>
      {#if reset.error}<ErrorText>{reset.error}</ErrorText>{/if}
      <div class="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onclick={() => (copying = null)} disabled={reset.pending}>{t("common.cancel")}</Button>
        <Button
          size="sm"
          variant="primary"
          disabled={reset.pending}
          onclick={() => copying && void reset.run(copying.id, copying.from)}
        >
          {reset.pending ? t("common.saving") : t("variants.copyConfirm")}
        </Button>
      </div>
    </div>
  </Modal>
{/if}
