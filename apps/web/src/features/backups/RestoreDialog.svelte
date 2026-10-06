<script lang="ts">
  import type { AdminConnectionSummary, BackupSummary, RestoreResult } from "@nebuladb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { AlertTriangleIcon, DatabaseIcon } from "@/components/icons/Icons";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Input from "@/components/ui/Input.svelte";
  import { LABEL_CLASS } from "@/components/ui/inputStyles";
  import Select from "@/components/ui/Select.svelte";
  import { parseServerTime } from "@/features/sql/format";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatDateTime, formatNumber } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { describeApiError } from "@/i18n/serverErrorMessages";
  import { ApiError } from "@/services/ApiError";
  import { restoreBackup } from "@/services/backupsApi";
  import { listAdminConnections } from "@/services/dbAdminApi";

  /**
   * Puts a backup's rows back: which tables, into which database, and the
   * target's name retyped — a restore empties those tables first. The server
   * decides what is allowed (same engine, tables present, nothing left
   * pointing at an emptied table); what it refuses is shown as it says it.
   */
  let {
    backup,
    source,
    onClose,
  }: { backup: BackupSummary; source: AdminConnectionSummary; onClose: () => void } = $props();

  const { t } = useTranslation();
  const connections = useAsyncResource(listAdminConnections);
  // The dialog is opened for one backup and one source; both are fixed for its lifetime.
  // svelte-ignore state_referenced_locally
  let targetId = $state(source.id);
  // svelte-ignore state_referenced_locally
  let chosen = $state<string[]>(backup.tables.map((table) => table.name));
  let safetyBackup = $state(true);
  let typed = $state("");
  let pending = $state(false);
  let error = $state<string | null>(null);
  let refusal = $state<string[]>([]);
  let result = $state.raw<RestoreResult | null>(null);

  // Only databases of the same engine: the rows are kept as that engine prints them.
  const candidates = $derived(
    (connections.data ?? [source]).filter((candidate) => candidate.engine === backup.engine && !candidate.readOnly),
  );
  const target = $derived(candidates.find((candidate) => candidate.id === targetId) ?? null);
  const options = $derived(
    candidates.map((candidate) => ({
      value: candidate.id,
      label: candidate.name,
      hint: candidate.environment ?? undefined,
      icon: DatabaseIcon,
    })),
  );
  const ready = $derived(!pending && target !== null && chosen.length > 0 && typed === target.name);

  function toggle(name: string, checked: boolean) {
    chosen = checked ? [...chosen, name] : chosen.filter((other) => other !== name);
  }

  /** What the server named when it refused: the tables in the way, the columns missing. */
  function describeRefusal(details: Record<string, unknown>): string[] {
    const lines: string[] = [];
    if (Array.isArray(details.dependents)) {
      lines.push(t("backups.restoreDialog.dependents", { tables: (details.dependents as string[]).join(", ") }));
    }
    if (Array.isArray(details.missing)) {
      for (const entry of details.missing as { table: string; columns?: string[] }[]) {
        lines.push(
          entry.columns
            ? t("backups.restoreDialog.missingColumns", { table: entry.table, columns: entry.columns.join(", ") })
            : t("backups.restoreDialog.missingTable", { table: entry.table }),
        );
      }
    }
    if (Array.isArray(details.cycles)) {
      for (const cycle of details.cycles as string[][]) lines.push(cycle.join(" → "));
    }
    return lines;
  }

  async function submit() {
    if (!ready || !target) return;
    pending = true;
    error = null;
    refusal = [];
    try {
      result = await restoreBackup(backup.id, {
        connectionId: target.id,
        // Everything ticked is "the whole backup": no list, so the server takes all of it.
        tables: chosen.length === backup.tables.length ? undefined : chosen,
        confirmName: typed,
        skipSafetyBackup: !safetyBackup,
      });
    } catch (err) {
      error = describeApiError(err, t);
      if (err instanceof ApiError) refusal = describeRefusal(err.details);
    } finally {
      pending = false;
    }
  }
</script>

<Modal
  title={t("backups.restoreDialog.title", { date: formatDateTime(parseServerTime(backup.startedAt), i18n.locale) })}
  {onClose}
  dismissable={!pending}
>
  {#if result}
    <div class="flex flex-col gap-3 text-xs" data-testid="restore-result">
      <p class={`m-0 text-body font-semibold ${result.success ? "text-success" : "text-danger"}`}>
        {result.success ? t("backups.restoreDialog.done") : t("backups.restoreDialog.failed")}
      </p>
      <ul class="m-0 list-none space-y-0.5 p-0 font-mono">
        {#each result.tables as table (table.name)}
          <li class={table.error ? "text-danger" : "text-text"}>
            {table.name} : {t("backups.restoreDialog.tableResult", {
              deleted: table.deleted ?? 0,
              inserted: table.inserted,
            })}
            {#if table.error}— {table.error}{/if}
          </li>
        {/each}
      </ul>
      <p class="m-0 text-text-muted">
        {result.safetyBackupId ? t("backups.restoreDialog.safetyKept") : t("backups.restoreDialog.safetySkipped")}
      </p>
      <div class="flex justify-end border-t border-border pt-3">
        <Button size="sm" variant="primary" onclick={onClose}>{t("common.close")}</Button>
      </div>
    </div>
  {:else}
    <form
      class="flex flex-col gap-3 text-xs"
      onsubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div class="flex items-start gap-2.5 text-body leading-relaxed text-text-secondary">
        <Icon icon={AlertTriangleIcon} size={16} class="mt-0.5 shrink-0 text-danger" />
        <p class="m-0">{t("backups.restoreDialog.warning")}</p>
      </div>

      <fieldset class="m-0 border-0 p-0">
        <legend class={LABEL_CLASS}>{t("backups.restoreDialog.tables")}</legend>
        <div class="mt-1.5 grid max-h-40 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto">
          {#each backup.tables as table (table.name)}
            <Checkbox
              checked={chosen.includes(table.name)}
              disabled={pending}
              onChange={(checked) => toggle(table.name, checked)}
            >
              <span class="font-mono">{table.name}</span>
              <span class="text-text-muted"> · {formatNumber(table.rows, i18n.locale)}</span>
            </Checkbox>
          {/each}
        </div>
      </fieldset>

      <label class="flex flex-col gap-1.5">
        <span class={LABEL_CLASS}>{t("backups.restoreDialog.target")}</span>
        <Select
          aria-label={t("backups.restoreDialog.target")}
          value={targetId}
          {options}
          disabled={pending}
          onChange={(id) => {
            targetId = id;
            typed = "";
          }}
        />
      </label>

      <Checkbox bind:checked={safetyBackup} disabled={pending} hint={t("backups.restoreDialog.safetyHint")}>
        {t("backups.restoreDialog.safety")}
      </Checkbox>

      {#if target}
        <label class="flex flex-col gap-1.5">
          <span class={LABEL_CLASS}>{t("ui.confirm.typeToConfirm", { text: target.name })}</span>
          <Input bind:value={typed} autocomplete="off" spellcheck="false" disabled={pending} wrapperClassName="w-full" />
        </label>
      {/if}

      {#if error}
        <ErrorText>{error}</ErrorText>
        {#if refusal.length > 0}
          <ul class="m-0 list-disc space-y-0.5 pl-5 text-danger">
            {#each refusal as line (line)}<li>{line}</li>{/each}
          </ul>
        {/if}
      {/if}

      <div class="flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button size="sm" variant="ghost" onclick={onClose} disabled={pending}>{t("common.cancel")}</Button>
        <Button type="submit" size="sm" variant="danger" disabled={!ready}>
          {pending ? t("backups.restoreDialog.running") : t("backups.restore")}
        </Button>
      </div>
    </form>
  {/if}
</Modal>
