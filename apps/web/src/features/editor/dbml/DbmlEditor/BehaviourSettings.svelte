<script lang="ts">
  import { useTranslation } from "@/i18n/i18n.svelte";
  import type { TranslationKeyOf } from "@/types";
  import { SYNC_DELAY_CHOICES, behaviourPrefs, updateBehaviourPrefs } from "./behaviourPrefs.svelte";

  /** The list of everything the editor does without being asked, each with its switch. */
  const { t } = useTranslation();

  const onOff = [
    { value: true, label: "dbml.settings.on" },
    { value: false, label: "dbml.settings.off" },
  ] as const;
</script>

{#snippet choices<T>(
  label: TranslationKeyOf,
  current: T,
  options: readonly { value: T; label: string }[],
  onPick: (value: T) => void,
)}
  <div class="flex items-center justify-between gap-3">
    <span id={`dbml-setting-${label}`}>{t(label)}</span>
    <div class="flex shrink-0 overflow-hidden rounded border border-border" role="group" aria-labelledby={`dbml-setting-${label}`}>
      {#each options as option (option.value)}
        <button
          type="button"
          aria-pressed={option.value === current}
          onclick={() => onPick(option.value)}
          class={`px-1.5 py-0.5 ${option.value === current ? "bg-primary text-white" : "hover:bg-surface-hover"}`}
        >
          {option.label}
        </button>
      {/each}
    </div>
  </div>
{/snippet}

<div class="flex w-[330px] flex-col gap-2 text-[11.5px] text-text">
  <div class="font-semibold">{t("dbml.settings.title")}</div>
  <p class="text-text-muted">{t("dbml.settings.intro")}</p>
  {@render choices(
    "dbml.settings.format",
    behaviourPrefs.formatMode,
    [
      { value: "never", label: t("dbml.settings.formatNever") },
      { value: "onSave", label: t("dbml.settings.formatOnSave") },
    ] as const,
    (formatMode) => updateBehaviourPrefs({ formatMode }),
  )}
  {@render choices(
    "dbml.settings.autoComplete",
    behaviourPrefs.autoComplete,
    onOff.map((option) => ({ value: option.value, label: t(option.label) })),
    (autoComplete) => updateBehaviourPrefs({ autoComplete }),
  )}
  {@render choices(
    "dbml.settings.closeBrackets",
    behaviourPrefs.closeBrackets,
    onOff.map((option) => ({ value: option.value, label: t(option.label) })),
    (closeBrackets) => updateBehaviourPrefs({ closeBrackets }),
  )}
  <!-- Fixed, shown for completeness: it used to sit in the status bar, which has no room left for a constant. -->
  <div class="flex items-center justify-between gap-3">
    <span>{t("dbml.indentation")}</span>
    <span class="text-text-muted">{t("dbml.twoSpaces")}</span>
  </div>
  {@render choices(
    "dbml.settings.syncDelay",
    behaviourPrefs.syncDelayMs,
    SYNC_DELAY_CHOICES.map((value) => ({
      value,
      label: value === 0 ? t("dbml.settings.syncManual") : t("dbml.settings.syncDelayValue", { seconds: value / 1000 }),
    })),
    (syncDelayMs) => updateBehaviourPrefs({ syncDelayMs }),
  )}
</div>
