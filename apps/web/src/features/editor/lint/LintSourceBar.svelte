<script lang="ts">
  import type { LintSettings } from "@athanordb/dbml-engine";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import Select from "@/components/ui/Select.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { LintPresetChoice, LintSource } from "@/services/lintApi";

  /**
   * Where this project's rules come from: a preset of the instance's library,
   * the instance default, the built-in rules — or a version of its own. A
   * project administrator picks one here; choosing "its own version" makes a
   * copy of the rules in force, which can then be edited freely.
   */
  let {
    source,
    presets,
    settings,
    canManage,
    onChoosePreset,
    onSaveOwn,
  }: {
    source: LintSource;
    presets: LintPresetChoice[];
    settings: LintSettings;
    canManage: boolean;
    onChoosePreset: (presetId: string | null) => Promise<void>;
    onSaveOwn: (settings: LintSettings) => Promise<void>;
  } = $props();

  const { t } = useTranslation();

  const DEFAULT_CHOICE = "default";
  const OWN_CHOICE = "own";
  const current = $derived(
    source.kind === "own" ? OWN_CHOICE : source.kind === "preset" ? (source.presetId ?? DEFAULT_CHOICE) : DEFAULT_CHOICE,
  );
  const options = $derived([
    { value: DEFAULT_CHOICE, label: t("lint.source.choiceDefault") },
    ...presets.map((preset) => ({ value: preset.id, label: preset.name, hint: preset.description || undefined })),
    { value: OWN_CHOICE, label: t("lint.source.choiceOwn") },
  ]);

  const choose = useAsyncAction(async (choice: string) => {
    if (choice === current) return;
    if (choice === OWN_CHOICE) await onSaveOwn(settings);
    else await onChoosePreset(choice === DEFAULT_CHOICE ? null : choice);
  });

  const sentence = $derived(
    source.kind === "own"
      ? t("lint.source.own")
      : source.kind === "preset"
        ? t("lint.source.preset", { name: source.presetName ?? "" })
        : source.kind === "default"
          ? t("lint.source.default", { name: source.presetName ?? "" })
          : t("lint.source.builtin"),
  );
</script>

<section
  class="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface p-3 text-xs"
  aria-label={t("lint.source.title")}
  data-testid="lint-source"
  data-source={source.kind}
>
  <div class="min-w-0 flex-1">
    <p class="m-0 font-semibold text-text" data-testid="lint-source-text">{sentence}</p>
    {#if canManage}<Hint>{source.kind === "own" ? t("lint.source.ownHint") : t("lint.source.followHint")}</Hint>{/if}
  </div>
  {#if canManage}
    <Select
      size="sm"
      class="w-64"
      value={current}
      {options}
      disabled={choose.pending}
      aria-label={t("lint.source.choose")}
      onChange={(choice) => void choose.run(choice)}
    />
  {/if}
  {#if choose.error}<ErrorText>{choose.error}</ErrorText>{/if}
</section>
