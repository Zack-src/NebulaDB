<script lang="ts">
  import {
    MAX_CUSTOM_RULES,
    compileLintPattern,
    type CustomLintRule,
    type LintLevel,
  } from "@athanordb/dbml-engine";
  import Icon from "@/components/icons/Icon.svelte";
  import { PlusIcon, TrashIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Input from "@/components/ui/Input.svelte";
  import Select from "@/components/ui/Select.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";

  /**
   * The rules written for these settings: names of tables or columns that
   * must (or must not) match a pattern. Declarative — nothing typed here runs
   * as code. Edited as a draft and saved together, because a half-typed
   * pattern is not a rule yet.
   */
  let {
    rules,
    disabled,
    onSave,
  }: {
    rules: CustomLintRule[];
    disabled: boolean;
    onSave: (rules: CustomLintRule[]) => Promise<void>;
  } = $props();

  const { t } = useTranslation();

  // `null` while nothing is being edited: the list shows what is saved.
  let draft = $state<CustomLintRule[] | null>(null);
  const shown = $derived(draft ?? rules);
  const save = useAsyncAction(async (next: CustomLintRule[]) => {
    await onSave(next);
    draft = null;
  });

  const LEVELS: LintLevel[] = ["off", "info", "warning", "error"];
  const levelOptions = $derived(LEVELS.map((level) => ({ value: level, label: t(`lint.level.${level}`) })));
  const targetOptions = $derived([
    { value: "table" as const, label: t("lint.custom.target.table") },
    { value: "column" as const, label: t("lint.custom.target.column") },
  ]);
  const mustOptions = $derived([
    { value: "match" as const, label: t("lint.custom.must.match") },
    { value: "not-match" as const, label: t("lint.custom.must.not-match") },
  ]);

  const slug = (label: string) =>
    label
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 36);

  function edit(index: number, patch: Partial<CustomLintRule>) {
    const next = [...shown];
    next[index] = { ...next[index], ...patch };
    draft = next;
  }

  function add() {
    draft = [
      ...shown,
      { id: "", label: "", target: "table", must: "match", pattern: "", level: "warning" },
    ];
  }

  const remove = (index: number) => (draft = shown.filter((_, i) => i !== index));

  /** What is wrong with a rule as typed, in words; `null` when it can be saved. */
  function problem(rule: CustomLintRule): string | null {
    if (!rule.label.trim()) return t("lint.custom.errorLabel");
    if (!rule.pattern.trim() || !compileLintPattern(rule.pattern)) return t("lint.custom.errorPattern");
    if (rule.appliesTo && !compileLintPattern(rule.appliesTo)) return t("lint.custom.errorScope");
    return null;
  }

  const problems = $derived(shown.map(problem));
  const canSave = $derived(draft !== null && problems.every((p) => p === null));

  function commit() {
    if (!draft) return;
    // A new rule's id comes from its label; a saved one keeps its id, so exceptions that name it still hold.
    const taken = new Set(draft.filter((rule) => rule.id).map((rule) => rule.id));
    const next = draft.map((rule) => {
      if (rule.id) return rule;
      const base = slug(rule.label) || "rule";
      let id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`.slice(0, 40);
      taken.add(id);
      return { ...rule, id };
    });
    void save.run(next);
  }
</script>

<section class="mt-3" aria-labelledby="lint-custom-title" data-testid="lint-custom-rules">
  <div class="flex items-center gap-2">
    <h4 id="lint-custom-title" class="m-0 flex-1 text-label font-semibold text-text-secondary">
      {t("lint.custom.title")}
    </h4>
    <Button size="xs" variant="ghost" disabled={disabled || shown.length >= MAX_CUSTOM_RULES} onclick={add}>
      <Icon icon={PlusIcon} size={12} />
      {t("lint.custom.add")}
    </Button>
  </div>
  <p class="m-0 mt-1 text-text-muted">{t("lint.custom.hint")}</p>

  {#if shown.length === 0}
    <p class="m-0 mt-2 text-text-muted">{t("lint.custom.empty")}</p>
  {/if}

  <ul class="m-0 mt-2 flex list-none flex-col gap-2 p-0">
    {#each shown as rule, index (index)}
      <li class="rounded-sm border border-border bg-surface-raised p-2" data-custom-rule={rule.id || "new"}>
        <div class="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
          <Input
            inputSize="sm"
            value={rule.label}
            placeholder={t("lint.custom.labelPlaceholder")}
            aria-label={t("lint.custom.label")}
            {disabled}
            oninput={(event) => edit(index, { label: event.currentTarget.value })}
          />
          <Select
            size="sm"
            class="w-28"
            value={rule.target}
            options={targetOptions}
            aria-label={t("lint.custom.targetLabel")}
            {disabled}
            onChange={(target) => edit(index, { target })}
          />
          <Select
            size="sm"
            class="w-40"
            value={rule.must}
            options={mustOptions}
            aria-label={t("lint.custom.mustLabel")}
            {disabled}
            onChange={(must) => edit(index, { must })}
          />
          <Select
            size="sm"
            class="w-32"
            value={rule.level}
            options={levelOptions}
            aria-label={t("lint.custom.levelLabel")}
            {disabled}
            onChange={(level) => edit(index, { level })}
          />
        </div>
        <div class="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input
            inputSize="sm"
            class="font-mono"
            value={rule.pattern}
            placeholder={t("lint.custom.patternPlaceholder")}
            aria-label={t("lint.custom.pattern")}
            invalid={rule.pattern !== "" && !compileLintPattern(rule.pattern)}
            {disabled}
            oninput={(event) => edit(index, { pattern: event.currentTarget.value })}
          />
          <Input
            inputSize="sm"
            class="font-mono"
            value={rule.appliesTo ?? ""}
            placeholder={t("lint.custom.appliesToPlaceholder")}
            aria-label={t("lint.custom.appliesTo")}
            invalid={Boolean(rule.appliesTo) && !compileLintPattern(rule.appliesTo ?? "")}
            {disabled}
            oninput={(event) => edit(index, { appliesTo: event.currentTarget.value || undefined })}
          />
          <Button
            size="icon-xs"
            variant="ghost"
            {disabled}
            onclick={() => remove(index)}
            aria-label={t("lint.custom.remove")}
          >
            <Icon icon={TrashIcon} size={12} />
          </Button>
        </div>
        <div class="mt-2">
          <Input
            inputSize="sm"
            value={rule.message ?? ""}
            placeholder={t("lint.custom.messagePlaceholder")}
            aria-label={t("lint.custom.message")}
            {disabled}
            oninput={(event) => edit(index, { message: event.currentTarget.value || undefined })}
          />
        </div>
        {#if draft && problems[index]}<p class="m-0 mt-1 text-danger">{problems[index]}</p>{/if}
      </li>
    {/each}
  </ul>

  {#if draft}
    <div class="mt-2 flex items-center gap-2">
      <Button size="sm" variant="primary" disabled={!canSave || save.pending} onclick={commit}>
        {t("lint.custom.save")}
      </Button>
      <Button size="sm" variant="ghost" disabled={save.pending} onclick={() => (draft = null)}>
        {t("common.cancel")}
      </Button>
    </div>
  {/if}
  {#if save.error}<ErrorText>{save.error}</ErrorText>{/if}
</section>
