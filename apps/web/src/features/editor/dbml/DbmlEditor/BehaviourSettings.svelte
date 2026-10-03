<script lang="ts">
  import SegmentedControl from "@/components/ui/SegmentedControl.svelte";
  import Switch from "@/components/ui/Switch.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { SYNC_DELAY_CHOICES, behaviourPrefs, updateBehaviourPrefs } from "./behaviourPrefs.svelte";

  /** The list of everything the editor does without being asked, each with its switch. */
  const { t } = useTranslation();
</script>

<div class="flex w-[330px] flex-col gap-2 text-[11.5px] text-text">
  <div class="font-semibold">{t("dbml.settings.title")}</div>
  <p class="text-text-muted">{t("dbml.settings.intro")}</p>
  <div class="flex items-center justify-between gap-3">
    <span id="dbml-setting-format">{t("dbml.settings.format")}</span>
    <SegmentedControl
      size="xs"
      aria-labelledby="dbml-setting-format"
      value={behaviourPrefs.formatMode}
      options={[
        { value: "never", label: t("dbml.settings.formatNever") },
        { value: "onSave", label: t("dbml.settings.formatOnSave") },
      ] as const}
      onChange={(formatMode) => updateBehaviourPrefs({ formatMode })}
    />
  </div>
  <div class="flex items-center justify-between gap-3">
    <span id="dbml-setting-complete">{t("dbml.settings.autoComplete")}</span>
    <Switch
      size="sm"
      aria-labelledby="dbml-setting-complete"
      checked={behaviourPrefs.autoComplete}
      onChange={(autoComplete) => updateBehaviourPrefs({ autoComplete })}
    />
  </div>
  <div class="flex items-center justify-between gap-3">
    <span id="dbml-setting-brackets">{t("dbml.settings.closeBrackets")}</span>
    <Switch
      size="sm"
      aria-labelledby="dbml-setting-brackets"
      checked={behaviourPrefs.closeBrackets}
      onChange={(closeBrackets) => updateBehaviourPrefs({ closeBrackets })}
    />
  </div>
  <!-- Fixed, shown for completeness: it used to sit in the status bar, which has no room left for a constant. -->
  <div class="flex items-center justify-between gap-3">
    <span>{t("dbml.indentation")}</span>
    <span class="text-text-muted">{t("dbml.twoSpaces")}</span>
  </div>
  <div class="flex items-center justify-between gap-3">
    <span id="dbml-setting-sync">{t("dbml.settings.syncDelay")}</span>
    <SegmentedControl
      size="xs"
      aria-labelledby="dbml-setting-sync"
      value={behaviourPrefs.syncDelayMs}
      options={SYNC_DELAY_CHOICES.map((value) => ({
        value,
        label: value === 0 ? t("dbml.settings.syncManual") : t("dbml.settings.syncDelayValue", { seconds: value / 1000 }),
      }))}
      onChange={(syncDelayMs) => updateBehaviourPrefs({ syncDelayMs })}
    />
  </div>
</div>
