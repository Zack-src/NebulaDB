<script lang="ts">
  import { untrack } from "svelte";
  import { DEFAULT_LINT_SETTINGS, type LintSettings } from "@athanordb/dbml-engine";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Field from "@/components/ui/Field.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import LintSettingsCard from "@/features/editor/lint/LintSettingsCard.svelte";
  import { createLintPreset, updateLintPreset, type LintPreset } from "@/services/lintApi";

  /**
   * Creates a preset or edits one: a name, a description, and the same rules
   * card a project has. Nothing is saved until "Enregistrer" — the card only
   * edits a draft here.
   */
  let {
    preset,
    onClose,
    onSaved,
  }: { preset: LintPreset | null; onClose: () => void; onSaved: () => void } = $props();

  const { t } = useTranslation();
  // The form starts from the preset it was opened on; it is not tied to later changes of that prop.
  const initial = untrack(() => preset);
  let name = $state(initial?.name ?? "");
  let description = $state(initial?.description ?? "");
  // A project's exceptions name its own tables: they mean nothing in a preset shared by several.
  let settings = $state.raw<LintSettings>({ ...(initial?.settings ?? DEFAULT_LINT_SETTINGS), ignores: [] });

  const save = useAsyncAction(async () => {
    const input = { name: name.trim(), description: description.trim(), settings };
    if (preset) await updateLintPreset(preset.id, input);
    else await createLintPreset(input);
    onSaved();
  });
</script>

<Modal title={preset ? t("lint.presets.editTitle", { name: preset.name }) : t("lint.presets.newTitle")} {onClose} wide>
  <div data-testid="lint-preset-form">
    <Field label={t("lint.presets.name")} bind:value={name} maxlength={100} autofocus />
    <Field label={t("lint.presets.description")} bind:value={description} maxlength={300} />
    <LintSettingsCard
      {settings}
      canManage
      onSave={async (next) => {
        settings = next;
      }}
    />
    {#if save.error}<ErrorText>{save.error}</ErrorText>{/if}
    <div class="mt-4 flex justify-end gap-2">
      <Button variant="ghost" onclick={onClose} disabled={save.pending}>{t("common.cancel")}</Button>
      <Button variant="primary" disabled={!name.trim() || save.pending} onclick={() => void save.run()}>
        {t("lint.presets.save")}
      </Button>
    </div>
  </div>
</Modal>
