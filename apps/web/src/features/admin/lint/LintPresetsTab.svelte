<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { PlusIcon, TrashIcon } from "@/components/icons/Icons";
  import ConfirmDialog from "@/components/overlays/ConfirmDialog.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import List from "@/components/ui/List.svelte";
  import ListMain from "@/components/ui/ListMain.svelte";
  import ListRow from "@/components/ui/ListRow.svelte";
  import { toast } from "@/components/ui/toast.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { deleteLintPreset, fetchLintPresets, setDefaultLintPreset, type LintPreset } from "@/services/lintApi";
  import LintApplyModal from "./LintApplyModal.svelte";
  import LintPresetModal from "./LintPresetModal.svelte";

  /**
   * Admin → Lint: the library of lint presets. A preset is a rule set a
   * project can follow; the one marked default applies to every project that
   * chose nothing. Each project may still keep a version of its own.
   */
  const { t } = useTranslation();
  const library = useAsyncResource(fetchLintPresets);
  const list = $derived(library.data?.presets ?? []);

  // `undefined`: closed · `null`: creating · a preset: editing it.
  let editing = $state<LintPreset | null | undefined>(undefined);
  let applying = $state<LintPreset | null>(null);
  let deleting = $state<LintPreset | null>(null);

  const toggleDefault = useAsyncAction(async (preset: LintPreset) => {
    await setDefaultLintPreset(preset.isDefault ? null : preset.id);
    library.reload();
  });

  const remove = useAsyncAction(async (preset: LintPreset) => {
    const result = await deleteLintPreset(preset.id);
    deleting = null;
    toast.success(t("lint.presets.deleted", { name: preset.name, count: result.detached }));
    library.reload();
  });

  const refresh = () => {
    editing = undefined;
    applying = null;
    library.reload();
  };
  const shownError = $derived(library.error ?? toggleDefault.error);
</script>

<div data-testid="lint-presets">
  <div class="mb-3 flex items-start gap-3">
    <p class="m-0 max-w-[640px] flex-1 text-xs text-text-muted">{t("lint.presets.hint")}</p>
    <Button variant="primary" size="sm" onclick={() => (editing = null)}>
      <Icon icon={PlusIcon} size={13} />
      {t("lint.presets.new")}
    </Button>
  </div>
  {#if shownError}<ErrorText>{shownError}</ErrorText>{/if}

  {#if list.length === 0}
    <EmptyState>{library.loading ? t("common.loading") : t("lint.presets.empty")}</EmptyState>
  {:else}
    <List>
      {#each list as preset (preset.id)}
        <ListRow>
          <ListMain>
            <span class="flex flex-wrap items-center gap-2" data-preset={preset.name}>
              <span class="font-semibold">{preset.name}</span>
              {#if preset.isDefault}<Badge tone="admin">{t("lint.presets.defaultBadge")}</Badge>{/if}
              <span class="text-xs text-text-muted">
                {t("lint.presets.followers", { count: preset.projectCount })}
              </span>
            </span>
            {#if preset.description}<span class="text-xs text-text-muted">{preset.description}</span>{/if}
          </ListMain>
          <Button size="sm" variant="ghost" onclick={() => (editing = preset)}>{t("lint.presets.edit")}</Button>
          <Button size="sm" variant="ghost" onclick={() => (applying = preset)}>{t("lint.presets.applyTo")}</Button>
          <Button size="sm" variant="outline" disabled={toggleDefault.pending} onclick={() => void toggleDefault.run(preset)}>
            {preset.isDefault ? t("lint.presets.unsetDefault") : t("lint.presets.setDefault")}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            data-tooltip={t("lint.presets.delete")}
            aria-label={t("lint.presets.delete")}
            onclick={() => (deleting = preset)}
          >
            <Icon icon={TrashIcon} size={13} />
          </Button>
        </ListRow>
      {/each}
    </List>
  {/if}
</div>

{#if editing !== undefined}
  <LintPresetModal preset={editing} onClose={() => (editing = undefined)} onSaved={refresh} />
{/if}
{#if applying}
  <LintApplyModal preset={applying} onClose={() => (applying = null)} onApplied={refresh} />
{/if}
{#if deleting}
  <ConfirmDialog
    title={t("lint.presets.deleteTitle", { name: deleting.name })}
    message={t("lint.presets.deleteMessage", { count: deleting.projectCount })}
    confirmLabel={t("lint.presets.delete")}
    danger="warning"
    pending={remove.pending}
    error={remove.error}
    onConfirm={() => void remove.run(deleting!)}
    onCancel={() => (deleting = null)}
  />
{/if}
