<script lang="ts">
  import {
    LINT_LEVELS,
    LINT_PROFILES,
    LINT_RULES,
    resolveLintLevels,
    type LintIgnore,
    type LintLevel,
    type CustomLintRule,
    type LintProfile,
    type LintRuleId,
    type LintRuleKey,
    type LintSettings,
  } from "@nebuladb/dbml-engine";
  import Icon from "@/components/icons/Icon.svelte";
  import { CloseIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { INPUT_SM_CLASS } from "@/components/ui/inputStyles";
  import SegmentedControl from "@/components/ui/SegmentedControl.svelte";
  import Select from "@/components/ui/Select.svelte";
  import Switch from "@/components/ui/Switch.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import CustomRulesEditor from "./CustomRulesEditor.svelte";
  import { isCustomRule } from "./lintText";

  /**
   * The linter's rules for this project: a profile, the level of each rule,
   * the two custom lists, the tables excepted, and whether an error stops a
   * deployment. Everyone sees them; project administrators change them, and
   * each change is saved at once.
   */
  let {
    settings,
    canManage,
    onSave,
  }: {
    settings: LintSettings;
    canManage: boolean;
    onSave: (settings: LintSettings) => Promise<void>;
  } = $props();

  const { t } = useTranslation();
  const save = useAsyncAction((next: LintSettings) => onSave(next));
  const locked = $derived(!canManage || save.pending);
  const levels = $derived(resolveLintLevels(settings));

  const profileOptions = $derived(
    LINT_PROFILES.map((profile) => ({ value: profile, label: t(`lint.profile.${profile}`) })),
  );
  const levelOptions = $derived(LINT_LEVELS.map((level) => ({ value: level, label: t(`lint.level.${level}`) })));

  // A named profile is its levels and nothing else; `custom` starts from
  // whatever was in force, so switching to it changes nothing by itself.
  function setProfile(profile: LintProfile) {
    void save.run({ ...settings, profile, rules: profile === "custom" ? customRules(levels) : {} });
  }

  /** The levels that differ from `standard`, the base `custom` is read against. */
  function customRules(wanted: Record<LintRuleId, LintLevel>): Partial<Record<LintRuleId, LintLevel>> {
    const base = resolveLintLevels({ ...settings, profile: "standard", rules: {} });
    const rules: Partial<Record<LintRuleId, LintLevel>> = {};
    for (const ruleId of LINT_RULES) if (wanted[ruleId] !== base[ruleId]) rules[ruleId] = wanted[ruleId];
    return rules;
  }

  // Changing one rule of a named profile makes it a custom one.
  function setLevel(ruleId: LintRuleId, level: LintLevel) {
    void save.run({ ...settings, profile: "custom", rules: customRules({ ...levels, [ruleId]: level }) });
  }

  let forbiddenDraft = $state<string | null>(null);
  let requiredDraft = $state<string | null>(null);
  const toList = (text: string) =>
    text
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  function saveForbidden() {
    if (forbiddenDraft === null) return;
    const forbiddenTypes = toList(forbiddenDraft);
    forbiddenDraft = null;
    void save.run({ ...settings, forbiddenTypes });
  }
  function saveRequired() {
    if (requiredDraft === null) return;
    const requiredColumns = toList(requiredDraft);
    requiredDraft = null;
    void save.run({ ...settings, requiredColumns });
  }

  const removeIgnore = (ignore: LintIgnore) =>
    save.run({
      ...settings,
      ignores: settings.ignores.filter(
        (entry) => !(entry.ruleId === ignore.ruleId && entry.tableId === ignore.tableId),
      ),
    });
  const ruleTitle = (ruleId: LintRuleKey) =>
    isCustomRule(ruleId)
      ? (settings.customRules.find((rule) => `custom:${rule.id}` === ruleId)?.label ?? ruleId.slice("custom:".length))
      : t(`lint.rule.${ruleId}.title` as "lint.rule.pk-required.title");
  const saveCustomRules = (customRules: CustomLintRule[]) => save.run({ ...settings, customRules }).then(() => {});
</script>

<section
  class="rounded-md border border-border bg-surface p-3 text-xs"
  aria-labelledby="lint-settings-title"
  data-testid="lint-settings"
>
  <div class="mb-2 flex flex-wrap items-center gap-3">
    <h3 id="lint-settings-title" class="m-0 flex-1 text-body-sm font-semibold text-text">
      {t("lint.settings.title")}
    </h3>
    {#if canManage}
      <SegmentedControl
        size="sm"
        value={settings.profile}
        options={profileOptions}
        onChange={setProfile}
        aria-label={t("lint.settings.profile")}
      />
    {:else}
      <span class="text-text-muted">{t(`lint.profile.${settings.profile}`)}</span>
    {/if}
  </div>
  <Hint>{canManage ? t("lint.settings.hint") : t("lint.settings.readOnly")}</Hint>

  <ul class="m-0 mt-2 list-none p-0" aria-label={t("lint.settings.rules")}>
    {#each LINT_RULES as ruleId (ruleId)}
      <li class="flex items-center gap-3 border-b border-border py-1.5 last:border-b-0" data-rule={ruleId}>
        <span class="min-w-0 flex-1">
          <span class="font-semibold text-text">{ruleTitle(ruleId)}</span>
          <span class="ml-1 font-mono text-caption text-text-muted">{ruleId}</span>
        </span>
        <Select
          size="sm"
          class="w-36"
          aria-label={ruleTitle(ruleId)}
          value={levels[ruleId]}
          options={levelOptions}
          disabled={locked}
          onChange={(level) => setLevel(ruleId, level)}
        />
      </li>
    {/each}
  </ul>

  <div class="mt-3 grid gap-2 sm:grid-cols-2">
    <label class="flex flex-col gap-1">
      <span class="text-text-secondary">{t("lint.settings.forbiddenTypes")}</span>
      <input
        class={INPUT_SM_CLASS}
        placeholder="json, float"
        value={forbiddenDraft ?? settings.forbiddenTypes.join(", ")}
        disabled={locked}
        oninput={(event) => (forbiddenDraft = event.currentTarget.value)}
        onblur={saveForbidden}
        onkeydown={(event) => {
          if (event.key === "Enter") saveForbidden();
        }}
      />
    </label>
    <label class="flex flex-col gap-1">
      <span class="text-text-secondary">{t("lint.settings.requiredColumns")}</span>
      <input
        class={INPUT_SM_CLASS}
        placeholder="tenant_id"
        value={requiredDraft ?? settings.requiredColumns.join(", ")}
        disabled={locked}
        oninput={(event) => (requiredDraft = event.currentTarget.value)}
        onblur={saveRequired}
        onkeydown={(event) => {
          if (event.key === "Enter") saveRequired();
        }}
      />
    </label>
  </div>

  <div class="mt-3 flex items-center gap-2">
    <Switch
      size="sm"
      checked={settings.blockDeployment}
      disabled={locked}
      onChange={(blockDeployment) => void save.run({ ...settings, blockDeployment })}
      aria-label={t("lint.settings.blockDeployment")}
    />
    <span>{t("lint.settings.blockDeployment")}</span>
  </div>

  <CustomRulesEditor rules={settings.customRules} disabled={locked} onSave={async (rules) => void (await saveCustomRules(rules))} />

  {#if settings.ignores.length > 0}
    <h4 class="m-0 mt-3 text-label font-semibold text-text-secondary">{t("lint.settings.exceptions")}</h4>
    <ul class="m-0 mt-1 flex list-none flex-wrap gap-1.5 p-0" aria-label={t("lint.settings.exceptions")}>
      {#each settings.ignores as ignore (`${ignore.ruleId}:${ignore.tableId}`)}
        <li class="flex items-center gap-1 rounded-sm border border-border bg-surface-raised py-0.5 pl-2 pr-0.5">
          <span class="font-mono">{ignore.tableName}</span>
          <span class="text-text-muted">· {ruleTitle(ignore.ruleId)}</span>
          {#if canManage}
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={save.pending}
              onclick={() => void removeIgnore(ignore)}
              aria-label={t("lint.settings.removeException", { table: ignore.tableName })}
            >
              <Icon icon={CloseIcon} size={11} />
            </Button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  <p class="m-0 mt-2 text-text-muted">{t("lint.settings.noteHint")}</p>
  {#if save.error}<ErrorText>{save.error}</ErrorText>{/if}
</section>
