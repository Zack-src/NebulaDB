<script lang="ts">
  import { TABLE_CELL, TABLE_ROW } from "@/components/ui/Table.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import ConfirmDialog from "@/components/overlays/ConfirmDialog.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import NumberInput from "@/components/ui/NumberInput.svelte";
  import { formatBytes } from "@/features/sql/format";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { formatDateTime, formatNumber } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { setRetention, type RetentionJournal } from "@/services/retentionApi";
  import { canReset, checkRetention, draftOf, isDirty, sourceLabelKey, type RetentionDraft } from "./retentionModel";

  let {
    journal,
    onChange,
    onPurge,
  }: {
    journal: RetentionJournal;
    onChange: (journal: RetentionJournal) => void;
    onPurge: (journal: RetentionJournal) => void;
  } = $props();

  const { t } = useTranslation();
  const EMPTY = "—";

  let confirming = $state(false);
  // The draft follows the journal (after a save, a reset or a reload) until it is edited.
  let draft = $derived<RetentionDraft>(draftOf(journal));

  const check = $derived(checkRetention(journal, draft));
  const dirty = $derived(isDirty(journal, draft));
  const unit = $derived(t(`admin.retention.unit.${journal.unit}`));
  const editorLabel = $derived(t("admin.retention.editorLabel", { journal: journal.label }));
  const problem = $derived(
    !dirty || check.ok
      ? null
      : t(`admin.retention.problem.${check.reason}`, { min: journal.min, max: journal.max }),
  );

  const save = useAsyncAction(async (value: number | null, confirm?: boolean) => {
    onChange(await setRetention(journal.key, value, confirm));
  });

  async function submit() {
    if (!check.ok || !dirty) return;
    if (check.needsConfirm) {
      confirming = true;
      return;
    }
    await save.run(check.value);
  }

  async function confirmed() {
    if (!check.ok) return;
    if (await save.run(check.value, true)) confirming = false;
  }
</script>

<tr class={`${TABLE_ROW} align-top`} data-testid="retention-row" data-key={journal.key}>
  <td class={`${TABLE_CELL.comfortable} min-w-[220px]`}>
    <div class="font-semibold text-text">{journal.label}</div>
    <div class="mt-0.5 max-w-[260px] text-caption leading-normal text-text-muted">{journal.description}</div>
  </td>
  <td class={TABLE_CELL.comfortable}>
    <form
      class="flex flex-col gap-1.5"
      onsubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div class="flex items-center gap-1.5">
        {#if draft.kind === "forever"}
          <span class="inline-flex h-7 items-center text-body-sm font-semibold">{t("admin.retention.forever")}</span>
        {:else}
          <NumberInput
            inputSize="sm"
            class="w-36"
            min={journal.min}
            max={journal.max}
            unit={unit}
            value={draft.value}
            invalid={problem !== null}
            aria-label={editorLabel}
            onChange={(value) => (draft = { kind: "value", value })}
          />
        {/if}
        {#if dirty}
          <Button type="submit" size="xs" variant="primary" disabled={!check.ok || save.pending}>
            {t("common.save")}
          </Button>
        {/if}
        {#if canReset(journal)}
          <Button size="xs" variant="ghost" disabled={save.pending} onclick={() => void save.run(null)}>
            {t("admin.retention.reset")}
          </Button>
        {/if}
      </div>
      {#if journal.allowForever}
        <Checkbox
          class="whitespace-nowrap"
          checked={draft.kind === "forever"}
          onChange={(checked) =>
            (draft = checked ? { kind: "forever" } : { kind: "value", value: journal.value || journal.defaultValue })}
        >
          {t("admin.retention.keepForever")}
        </Checkbox>
      {/if}
      {#if problem}<span class="text-caption text-danger" role="alert">{problem}</span>{/if}
      {#if save.error}<ErrorText>{save.error}</ErrorText>{/if}
    </form>
    <div class="mt-2">
    <Badge tone={journal.source === "db" ? "admin" : "muted"}>{t(sourceLabelKey(journal.source))}</Badge>
      <div class="mt-1 text-caption text-text-muted">
        {#if journal.source === "db" && journal.updatedAt}
          {t("admin.retention.updated", {
            who: journal.updatedBy?.email ?? EMPTY,
            date: formatDateTime(journal.updatedAt, i18n.locale),
          })}
        {:else if journal.source === "env" && journal.envVar}
          <span class="font-mono">{journal.envVar}</span>
        {:else}
          {t("admin.retention.defaultIs", { value: formatNumber(journal.defaultValue, i18n.locale), unit: t(`admin.retention.unit.${journal.unit}`) })}
        {/if}
      </div>
    </div>
  </td>
  <td class={`${TABLE_CELL.comfortable} whitespace-nowrap tabular-nums`}>
    <div>{t("admin.retention.rowCount", { count: journal.rows, rows: formatNumber(journal.rows, i18n.locale) })}</div>
    <div class="text-caption text-text-muted">{formatBytes(journal.bytes)}</div>
    <div class="text-caption text-text-muted">
      {t("admin.retention.oldest", { date: journal.oldest ? formatDateTime(journal.oldest, i18n.locale) : EMPTY })}
    </div>
  </td>
  <td class={`${TABLE_CELL.comfortable} text-text-secondary`}>
    {#if journal.lastPurge}
      <div class="whitespace-nowrap">{formatDateTime(journal.lastPurge.at, i18n.locale)}</div>
      <div class="text-caption text-text-muted">
        {t("admin.retention.lastPurge", {
          count: journal.lastPurge.deleted,
          rows: formatNumber(journal.lastPurge.deleted, i18n.locale),
          trigger: t(`admin.retention.trigger.${journal.lastPurge.trigger}`),
        })}
      </div>
    {:else}
      {EMPTY}
    {/if}
    <div class="mt-2">
      <Button size="xs" variant="danger" onclick={() => onPurge(journal)}>{t("admin.retention.purgeNow")}</Button>
    </div>
  </td>
</tr>

{#if confirming && check.ok}
  <ConfirmDialog
    title={t("admin.retention.shortTitle")}
    message={t("admin.retention.shortMessage", {
      journal: journal.label,
      value: check.value,
      unit,
      below: journal.confirmBelow ?? 0,
    })}
    confirmLabel={t("admin.retention.shortConfirm")}
    danger="warning"
    pending={save.pending}
    error={save.error}
    onConfirm={() => void confirmed()}
    onCancel={() => (confirming = false)}
  />
{/if}
