<script lang="ts">
  import {
    ENVIRONMENT_COLORS,
    ENVIRONMENT_NAME_MAX,
    ENVIRONMENT_PROTECTIONS,
    type EnvironmentStage,
    type EnvironmentStageInput,
  } from "@athanordb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { ChevronRightIcon, PlusIcon, TrashIcon } from "@/components/icons/Icons";
  import ConfirmDialog from "@/components/overlays/ConfirmDialog.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import { INPUT_SM_CLASS } from "@/components/ui/inputStyles";
  import List from "@/components/ui/List.svelte";
  import ListRow from "@/components/ui/ListRow.svelte";
  import Select from "@/components/ui/Select.svelte";
  import { toast } from "@/components/ui/toast.svelte";
  import EnvironmentBadge from "@/features/environments/EnvironmentBadge.svelte";
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

  const list = $derived(stages.data ?? []);
  const hasProduction = $derived(list.some((stage) => stage.production));

  const colorOptions = $derived(ENVIRONMENT_COLORS.map((value) => ({ value, label: t(`environments.color.${value}`) })));
  const protectionOptions = $derived(
    ENVIRONMENT_PROTECTIONS.map((value) => ({
      value,
      label: t(`environments.protection.${value}`),
      hint: t(`environments.protectionHint.${value}`),
    })),
  );

  const add = useAsyncAction(async () => {
    const name = newName.trim();
    if (!name) return;
    await createEnvironment({ name });
    newName = "";
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

  const busy = $derived(add.pending || save.pending || move.pending || remove.pending);
  const shownError = $derived(stages.error ?? add.error ?? save.error ?? move.error ?? remove.error);
</script>

<div>
  <p class="mb-4 max-w-[640px] text-xs text-text-muted">{t("environments.hint")}</p>

  {#if list.length > 0}
    <!-- The chain at a glance, in order. -->
    <div class="mb-3 flex flex-wrap items-center gap-1.5" aria-label={t("environments.chain")}>
      {#each list as stage, index (stage.id)}
        {#if index > 0}<Icon icon={ChevronRightIcon} size={12} class="text-text-muted" />{/if}
        <EnvironmentBadge name={stage.name} color={stage.color} production={stage.production} />
      {/each}
    </div>
  {/if}
  {#if stages.data && !hasProduction}
    <p class="mb-3 text-xs text-warning">{t("environments.noProduction")}</p>
  {/if}
  {#if shownError}<ErrorText>{shownError}</ErrorText>{/if}

  {#if list.length === 0}
    <EmptyState>{stages.loading ? t("common.loading") : t("environments.empty")}</EmptyState>
  {:else}
    <List>
      {#each list as stage, index (stage.id)}
        <ListRow>
          <span class="w-5 shrink-0 text-center font-mono text-xs text-text-muted">{index + 1}</span>
          <div class="flex shrink-0 flex-col">
            <button
              type="button"
              class="cursor-pointer border-0 bg-transparent p-0 leading-none text-text-muted hover:text-text disabled:cursor-default disabled:opacity-30"
              disabled={busy || index === 0}
              aria-label={t("environments.moveUp", { name: stage.name })}
              onclick={() => void move.run(index, -1)}
            >
              <Icon icon={ChevronRightIcon} size={12} class="-rotate-90" />
            </button>
            <button
              type="button"
              class="cursor-pointer border-0 bg-transparent p-0 leading-none text-text-muted hover:text-text disabled:cursor-default disabled:opacity-30"
              disabled={busy || index === list.length - 1}
              aria-label={t("environments.moveDown", { name: stage.name })}
              onclick={() => void move.run(index, 1)}
            >
              <Icon icon={ChevronRightIcon} size={12} class="rotate-90" />
            </button>
          </div>
          {#key stage.name}
            <input
              class={`${INPUT_SM_CLASS} w-40`}
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
          <Select
            size="sm"
            class="w-28"
            aria-label={t("environments.colorLabel", { name: stage.name })}
            value={stage.color}
            options={colorOptions}
            disabled={busy || stage.production}
            onChange={(color) => void save.run(stage, { color })}
          />
          <Select
            size="sm"
            class="w-36"
            aria-label={t("environments.protectionLabel", { name: stage.name })}
            value={stage.protection}
            options={protectionOptions}
            disabled={busy || stage.production}
            onChange={(protection) => void save.run(stage, { protection })}
          />
          <Checkbox
            checked={stage.production}
            disabled={busy}
            onChange={(production) => void save.run(stage, { production })}
          >
            <span class="text-xs">{t("environments.production")}</span>
          </Checkbox>
          <span class="ml-auto shrink-0 text-xs text-text-muted">
            {t("environments.connectionCount", { count: stage.connectionCount })}
          </span>
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
        </ListRow>
      {/each}
    </List>
  {/if}

  <form
    class="mt-3 flex items-center gap-2"
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
  </form>
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
