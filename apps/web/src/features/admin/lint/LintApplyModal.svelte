<script lang="ts">
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import List from "@/components/ui/List.svelte";
  import ListRow from "@/components/ui/ListRow.svelte";
  import { toast } from "@/components/ui/toast.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { applyLintPreset, type LintPreset } from "@/services/lintApi";
  import { fetchProjects } from "@/services/projectsApi";

  /** Points chosen projects at a preset. A project's own version of the rules is dropped: it follows the preset from then on. */
  let { preset, onClose, onApplied }: { preset: LintPreset; onClose: () => void; onApplied: () => void } = $props();

  const { t } = useTranslation();
  const projects = useAsyncResource(fetchProjects);
  let chosen = $state<Record<string, boolean>>({});

  const rows = $derived((projects.data ?? []).filter((project) => project.status !== "trashed"));
  const ids = $derived(rows.filter((project) => chosen[project.id]).map((project) => project.id));

  const apply = useAsyncAction(async () => {
    const result = await applyLintPreset(preset.id, ids);
    toast.success(t("lint.presets.applied", { count: result.applied, name: preset.name }));
    onApplied();
  });
</script>

<Modal title={t("lint.presets.applyTitle", { name: preset.name })} {onClose}>
  <div data-testid="lint-apply">
    <Hint>{t("lint.presets.applyHint")}</Hint>
    {#if projects.error}<ErrorText>{projects.error}</ErrorText>{/if}
    {#if rows.length === 0}
      <EmptyState>{projects.loading ? t("common.loading") : t("lint.presets.noProjects")}</EmptyState>
    {:else}
      <List>
        {#each rows as project (project.id)}
          <ListRow>
            <Checkbox bind:checked={chosen[project.id]}>{project.name}</Checkbox>
          </ListRow>
        {/each}
      </List>
    {/if}
    {#if apply.error}<ErrorText>{apply.error}</ErrorText>{/if}
    <div class="mt-4 flex justify-end gap-2">
      <Button variant="ghost" onclick={onClose} disabled={apply.pending}>{t("common.cancel")}</Button>
      <Button variant="primary" disabled={ids.length === 0 || apply.pending} onclick={() => void apply.run()}>
        {t("lint.presets.apply", { count: ids.length })}
      </Button>
    </div>
  </div>
</Modal>
