<script lang="ts">
  import PageIntro from "@/components/layout/PageIntro.svelte";
  import {
    ENVIRONMENT_COLORS,
    ENVIRONMENT_NAME_MAX,
    ENVIRONMENT_PROTECTIONS,
    type EnvironmentColor,
    type EnvironmentStage,
    type EnvironmentStageInput,
  } from "@nebuladb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { ChevronRightIcon, LockIcon, PlusIcon, TrashIcon } from "@/components/icons/Icons";
  import ConfirmDialog from "@/components/overlays/ConfirmDialog.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import { INPUT_SM_CLASS } from "@/components/ui/inputStyles";
  import SegmentedControl from "@/components/ui/SegmentedControl.svelte";
  import Switch from "@/components/ui/Switch.svelte";
  import { toast } from "@/components/ui/toast.svelte";
  import StageVariables from "@/features/admin/environments/StageVariables.svelte";
  import EnvironmentBadge, { STAGE_COLOR } from "@/features/environments/EnvironmentBadge.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import {
    createEnvironment,
    deleteEnvironment,
    fetchEnvironments,
    reorderEnvironments,
    updateEnvironment,
  } from "@/services/environmentsApi";

  /**
   * Admin → Environnements: the instance's deployment chain (DEV › … › Prod).
   * Each connection points at one of these stages; the one flagged production
   * is red everywhere and asks for the connection's name before a deployment.
   * Every change is immediate and audited server-side.
   */
  const { t } = useTranslation();
  const stages = useAsyncResource(fetchEnvironments);
  let newName = $state("");
  let deleting = $state<EnvironmentStage | null>(null);
  /** The stage whose settings are unfolded: one at a time keeps the chain readable. */
  let open = $state<string | null>(null);

  const list = $derived(stages.data ?? []);
  const hasProduction = $derived(list.some((stage) => stage.production));

  const protectionOptions = $derived(
    ENVIRONMENT_PROTECTIONS.map((value) => ({ value, label: t(`environments.protection.${value}`) })),
  );
  /** Stages offered as one-click additions: the usual names, minus the ones already in the chain. */
  const SUGGESTIONS: { name: string; color: EnvironmentColor }[] = [
    { name: "Development", color: "green" },
    { name: "QA", color: "violet" },
    { name: "Staging", color: "amber" },
    { name: "Pre-production", color: "orange" },
  ];
  const suggestions = $derived(
    SUGGESTIONS.filter((item) => !list.some((stage) => stage.name.toLowerCase() === item.name.toLowerCase())),
  );

  const add = useAsyncAction(async (input?: EnvironmentStageInput) => {
    const name = (input?.name ?? newName).trim();
    if (!name) return;
    const created = await createEnvironment({ ...input, name });
    if (!input) newName = "";
    open = created.id;
    stages.reload();
  });

  /** The usual chain in one click, for an instance that has none yet. */
  const quickStart = useAsyncAction(async () => {
    await createEnvironment({ name: "Development", color: "green" });
    await createEnvironment({ name: "Staging", color: "amber", protection: "protected" });
    await createEnvironment({ name: "Production", color: "red", protection: "protected", production: true });
    stages.reload();
  });

  const save = useAsyncAction(async (stage: EnvironmentStage, input: EnvironmentStageInput) => {
    await updateEnvironment(stage.id, input);
    stages.reload();
  });

  const move = useAsyncAction(async (index: number, delta: -1 | 1) => {
    const ids = list.map((stage) => stage.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await reorderEnvironments(ids);
    stages.reload();
  });

  const remove = useAsyncAction(async (stage: EnvironmentStage) => {
    await deleteEnvironment(stage.id);
    deleting = null;
    toast.success(t("environments.deleted", { name: stage.name }));
    stages.reload();
  });

  function rename(stage: EnvironmentStage, value: string) {
    const name = value.trim();
    if (name && name !== stage.name) void save.run(stage, { name });
  }

  const busy = $derived(add.pending || quickStart.pending || save.pending || move.pending || remove.pending);
  const shownError = $derived(
    stages.error ?? add.error ?? quickStart.error ?? save.error ?? move.error ?? remove.error,
  );
</script>

<div>
  <PageIntro>{t("environments.hint")}</PageIntro>

  {#if stages.data && list.length > 0 && !hasProduction}
    <p class="mb-3 text-xs text-warning">{t("environments.noProduction")}</p>
  {/if}
  {#if shownError}<ErrorText>{shownError}</ErrorText>{/if}

  {#if list.length === 0}
    <div
      class="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-surface px-6 py-10 text-center"
    >
      <p class="m-0 text-sm text-text-muted">{stages.loading ? t("common.loading") : t("environments.empty")}</p>
      {#if !stages.loading}
        <div class="flex items-center gap-1.5" aria-hidden="true">
          <EnvironmentBadge name="Development" color="green" />
          <Icon icon={ChevronRightIcon} size={12} class="text-text-muted" />
          <EnvironmentBadge name="Staging" color="amber" />
          <Icon icon={ChevronRightIcon} size={12} class="text-text-muted" />
          <EnvironmentBadge name="Production" color="red" production />
        </div>
        <Button variant="primary" size="sm" disabled={busy} onclick={() => void quickStart.run()}>
          <Icon icon={PlusIcon} size={12} />
          {t("environments.quickStart")}
        </Button>
        <p class="m-0 text-xs text-text-muted">{t("environments.quickStartHint")}</p>
      {/if}
    </div>
  {:else}
    <ol class="m-0 flex list-none flex-col p-0" aria-label={t("environments.chain")}>
      {#each list as stage, index (stage.id)}
        {@const shade = stage.production ? STAGE_COLOR.red : STAGE_COLOR[stage.color]}
        {@const expanded = open === stage.id}
        {#if index > 0}
          <li class="ml-[22px] h-3 w-px bg-border" aria-hidden="true"></li>
        {/if}
        <li
          class="overflow-hidden rounded-md border border-border bg-surface"
          style:border-left={`3px solid ${shade}`}
          data-stage={stage.name}
        >
          <div class="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <span
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold"
              style:color={shade}
              style:background-color={`color-mix(in srgb, ${shade} 14%, transparent)`}>{index + 1}</span
            >
            {#key stage.name}
              <input
                class={`${INPUT_SM_CLASS} w-44 font-semibold`}
                value={stage.name}
                maxlength={ENVIRONMENT_NAME_MAX}
                aria-label={t("environments.name")}
                disabled={busy}
                onblur={(event) => rename(stage, event.currentTarget.value)}
                onkeydown={(event) => {
                  if (event.key === "Enter") rename(stage, event.currentTarget.value);
                }}
              />
            {/key}
            <EnvironmentBadge name={stage.name} color={stage.color} production={stage.production} />
            {#if stage.protection !== "free" && !stage.production}
              <span class="flex items-center gap-1 text-xs text-text-muted">
                <Icon icon={LockIcon} size={11} />
                {t(`environments.protection.${stage.protection}`)}
              </span>
            {/if}
            <span class="ml-auto shrink-0 text-xs text-text-muted">
              {t("environments.connectionCount", { count: stage.connectionCount })}
              · {t("environments.variablesCount", { count: Object.keys(stage.variables).length })}
            </span>
            <div class="flex shrink-0 items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                disabled={busy || index === 0}
                aria-label={t("environments.moveUp", { name: stage.name })}
                data-tooltip={t("environments.moveUp", { name: stage.name })}
                onclick={() => void move.run(index, -1)}
              >
                <Icon icon={ChevronRightIcon} size={13} class="-rotate-90" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={busy || index === list.length - 1}
                aria-label={t("environments.moveDown", { name: stage.name })}
                data-tooltip={t("environments.moveDown", { name: stage.name })}
                onclick={() => void move.run(index, 1)}
              >
                <Icon icon={ChevronRightIcon} size={13} class="rotate-90" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={expanded}
                onclick={() => (open = expanded ? null : stage.id)}
              >
                {t("environments.configure")}
                <Icon icon={ChevronRightIcon} size={12} class={expanded ? "rotate-90" : ""} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                data-tooltip={t("common.delete")}
                aria-label={t("environments.delete", { name: stage.name })}
                disabled={busy}
                onclick={() => (deleting = stage)}
              >
                <Icon icon={TrashIcon} size={13} />
              </Button>
            </div>
          </div>

          {#if expanded}
            <div class="flex flex-col gap-4 border-t border-border bg-surface-raised px-4 py-3">
              <div class="grid grid-cols-[110px_1fr] items-center gap-x-3 gap-y-3 text-xs">
                <span class="font-semibold text-text">{t("environments.colorTitle")}</span>
                <div
                  class="flex flex-wrap items-center gap-2"
                  role="radiogroup"
                  aria-label={t("environments.colorLabel", { name: stage.name })}
                >
                  {#each ENVIRONMENT_COLORS as value (value)}
                    <button
                      type="button"
                      role="radio"
                      aria-checked={stage.color === value}
                      aria-label={t(`environments.color.${value}`)}
                      data-tooltip={t(`environments.color.${value}`)}
                      disabled={busy || stage.production}
                      class="h-5 w-5 cursor-pointer rounded-full border-2 disabled:cursor-default disabled:opacity-40"
                      style:background-color={STAGE_COLOR[value]}
                      style:border-color={stage.color === value ? "var(--color-text)" : "transparent"}
                      onclick={() => void save.run(stage, { color: value })}
                    ></button>
                  {/each}
                  {#if stage.production}<span class="text-text-muted">{t("environments.productionColorHint")}</span>{/if}
                </div>

                <span class="font-semibold text-text">{t("environments.protectionTitle")}</span>
                <div class="flex flex-col items-start gap-1">
                  <SegmentedControl
                    size="sm"
                    options={protectionOptions}
                    value={stage.protection}
                    aria-label={t("environments.protectionLabel", { name: stage.name })}
                    onChange={(protection) => void save.run(stage, { protection })}
                  />
                  <span class="text-text-muted">{t(`environments.protectionHint.${stage.protection}`)}</span>
                </div>

                <span class="font-semibold text-text">{t("environments.production")}</span>
                <label class="flex items-center gap-2">
                  <Switch
                    size="sm"
                    checked={stage.production}
                    disabled={busy}
                    aria-label={t("environments.production")}
                    onChange={(production) => void save.run(stage, { production })}
                  />
                  <span class="text-text-muted">{t("environments.productionHint")}</span>
                </label>
              </div>

              <div>
                <h3 class="m-0 mb-1.5 text-xs font-semibold text-text">{t("environments.variablesTitle")}</h3>
                {#key JSON.stringify(stage.variables)}
                  <StageVariables
                    {stage}
                    others={list.filter((other) => other.id !== stage.id)}
                    disabled={busy}
                    onSave={(variables) => void save.run(stage, { variables })}
                  />
                {/key}
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ol>

    <form
      class="mt-4 flex flex-wrap items-center gap-2"
      onsubmit={(event) => {
        event.preventDefault();
        void add.run();
      }}
    >
      <input
        class={`${INPUT_SM_CLASS} w-56`}
        bind:value={newName}
        maxlength={ENVIRONMENT_NAME_MAX}
        placeholder={t("environments.newPlaceholder")}
        aria-label={t("environments.newPlaceholder")}
      />
      <Button size="sm" variant="primary" type="submit" disabled={busy || !newName.trim()}>
        <Icon icon={PlusIcon} size={12} />
        {t("environments.add")}
      </Button>
      {#if suggestions.length > 0}
        <span class="ml-2 text-xs text-text-muted">{t("environments.suggestions")}</span>
        {#each suggestions as item (item.name)}
          <button
            type="button"
            class="cursor-pointer border-0 bg-transparent p-0 disabled:opacity-50"
            disabled={busy}
            onclick={() => void add.run({ name: item.name, color: item.color })}
          >
            <EnvironmentBadge name={item.name} color={item.color} />
          </button>
        {/each}
      {/if}
    </form>
  {/if}
</div>

{#if deleting}
  {@const stage = deleting}
  <ConfirmDialog
    title={t("environments.deleteTitle", { name: stage.name })}
    message={stage.connectionCount > 0
      ? t("environments.deleteMessageUsed", { name: stage.name, count: stage.connectionCount })
      : t("environments.deleteMessage", { name: stage.name })}
    danger={stage.connectionCount > 0 ? "warning" : "danger"}
    confirmLabel={t("common.delete")}
    pending={remove.pending}
    error={remove.error}
    onCancel={() => (deleting = null)}
    onConfirm={() => void remove.run(stage)}
  />
{/if}
