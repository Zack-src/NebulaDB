<script lang="ts">
  import BackupScopeDialog from "./BackupScopeDialog.svelte";
  import type { AdminConnectionSummary, BackupDestination, BackupSchedule, BackupSummary } from "@nebuladb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { ArchiveIcon, CloseIcon, DownloadIcon, LockIcon, LockOpenIcon, RestoreIcon, TrashIcon } from "@/components/icons/Icons";
  import ConfirmDialog from "@/components/overlays/ConfirmDialog.svelte";
  import Badge, { type BadgeTone } from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { formatBytes, parseServerTime } from "@/features/sql/format";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatDateTime, formatNumber } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import {
    backupDownloadUrl,
    cancelBackup,
    deleteBackup,
    listBackups,
    setBackupPinned,
    startBackup,
  } from "@/services/backupsApi";
  import BackupDestinationCard from "./BackupDestinationCard.svelte";
  import BackupScheduleCard from "./BackupScheduleCard.svelte";
  import RestoreDialog from "./RestoreDialog.svelte";

  /**
   * "Sauvegardes": the logical backups of one connected database — take one
   * now, see how the running one is doing, download, pin, delete, restore.
   * The copies taken automatically before a production deployment or a
   * restore show up here too, with what triggered them.
   */
  let { connection }: { connection: AdminConnectionSummary } = $props();

  const { t } = useTranslation();
  const backups = useAsyncResource(() => listBackups(connection.id));
  let restoring = $state.raw<BackupSummary | null>(null);
  let deleting = $state.raw<BackupSummary | null>(null);
  let choosingScope = $state(false);

  /** The schedule as last saved here — fresher than the list, which is only read again on demand. */
  let savedSchedule = $state.raw<BackupSchedule | null>(null);
  const schedule = $derived(savedSchedule ?? backups.data?.schedule ?? null);
  let savedDestination = $state.raw<BackupDestination | null>(null);
  const destination = $derived(savedDestination ?? backups.data?.destination ?? null);

  const list = $derived(backups.data?.backups ?? []);
  const running = $derived(list.some((backup) => backup.status === "running"));

  // A running backup is followed by reading the list again, not by a socket: it is one row changing every second or so.
  $effect(() => {
    if (!running) return;
    const timer = setInterval(() => backups.reload(), 1500);
    return () => clearInterval(timer);
  });

  const start = useAsyncAction(async () => {
    await startBackup(connection.id);
    backups.reload();
  });
  const act = useAsyncAction(async (work: () => Promise<void>) => {
    await work();
    backups.reload();
  });
  const remove = useAsyncAction(async (backup: BackupSummary) => {
    await deleteBackup(backup.id);
    deleting = null;
    backups.reload();
  });

  const STATUS_TONE: Record<BackupSummary["status"], BadgeTone> = {
    running: "admin",
    done: "success",
    failed: "danger",
    cancelled: "muted",
  };
  const when = (value: string) => formatDateTime(parseServerTime(value), i18n.locale);
</script>

<section data-testid="backups" aria-labelledby="backups-title">
  <div class="mb-2 flex flex-wrap items-center gap-3">
    <h3 id="backups-title" class="m-0 flex-1 text-body-sm font-semibold text-text">{t("backups.title")}</h3>
    {#if backups.data}
      <span class="text-xs text-text-muted">{t("backups.used", { size: formatBytes(backups.data.usedBytes) })}</span>
    {/if}
    <Button size="sm" variant="outline" onclick={() => (choosingScope = true)} disabled={running || start.pending}>
      {t("backups.scope.open")}
    </Button>
    <Button size="sm" variant="primary" onclick={() => void start.run()} disabled={running || start.pending}>
      <Icon icon={ArchiveIcon} size={13} />
      {t("backups.now")}
    </Button>
  </div>
  {#if backups.data}
    <Hint>
      {t("backups.hint", { max: formatBytes(backups.data.limits.maxBytes) })}
      {backups.data.limits.retentionDays > 0
        ? t("backups.retention", { count: backups.data.limits.retentionDays })
        : t("backups.retentionOff")}
    </Hint>
  {/if}
  {#if schedule}
    <BackupScheduleCard connectionId={connection.id} {schedule} onSaved={(saved) => (savedSchedule = saved)} />
  {/if}
  {#if destination}
    <BackupDestinationCard connectionId={connection.id} {destination} onSaved={(saved) => (savedDestination = saved)} />
  {/if}
  {#if backups.error ?? start.error ?? act.error}<ErrorText>{backups.error ?? start.error ?? act.error}</ErrorText>{/if}

  {#if list.length === 0}
    <EmptyState>{backups.loading ? t("common.loading") : t("backups.empty")}</EmptyState>
  {:else}
    <div class="mt-3 overflow-x-auto rounded-md border border-border">
      <table class="w-full border-collapse text-xs">
        <thead class="bg-surface-raised text-left text-text-secondary">
          <tr>
            <th class="px-2 py-1.5 font-semibold">{t("backups.col.date")}</th>
            <th class="px-2 py-1.5 font-semibold">{t("backups.col.trigger")}</th>
            <th class="px-2 py-1.5 font-semibold">{t("backups.col.status")}</th>
            <th class="px-2 py-1.5 font-semibold">{t("backups.col.content")}</th>
            <th class="px-2 py-1.5 font-semibold">{t("backups.col.size")}</th>
            <th class="px-2 py-1.5 font-semibold">{t("backups.col.kept")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each list as backup (backup.id)}
            <tr class="border-t border-border/60 align-top" data-status={backup.status} data-trigger={backup.trigger}>
              <td class="whitespace-nowrap px-2 py-1.5">{when(backup.startedAt)}</td>
              <td class="px-2 py-1.5">
                {t(`backups.trigger.${backup.trigger}`)}
                {#if backup.createdByName}<span class="text-text-muted"> · {backup.createdByName}</span>{/if}
                {#if backup.note}<span class="block text-text-muted">{backup.note}</span>{/if}
              </td>
              <td class="px-2 py-1.5">
                <Badge tone={STATUS_TONE[backup.status]}>{t(`backups.status.${backup.status}`)}</Badge>
                {#if backup.error}<span class="mt-1 block max-w-[320px] text-danger">{backup.error}</span>{/if}
              </td>
              <td class="px-2 py-1.5">
                {#if backup.status === "running"}
                  {t("backups.progress", { done: backup.tables.length, total: backup.tablesTotal })}
                {:else}
                  {t("backups.tables", { count: backup.tables.length })}
                {/if}
                · {t("backups.rows", { count: backup.rows, formatted: formatNumber(backup.rows, i18n.locale) })}
                {#if backup.scope}<span class="block font-mono text-text-muted">{backup.scope.join(", ")}</span>{/if}
              </td>
              <td class="whitespace-nowrap px-2 py-1.5">{formatBytes(backup.sizeBytes)}</td>
              <td class="whitespace-nowrap px-2 py-1.5 text-text-muted">
                {#if backup.pinned}
                  {t("backups.pinned")}
                {:else if backup.expiresAt}
                  {t("backups.until", { date: when(backup.expiresAt) })}
                {:else if backup.trigger === "scheduled" && backup.status === "done"}
                  {t("backups.keptBySchedule")}
                {/if}
              </td>
              <td class="px-1 py-1">
                <div class="flex items-center justify-end gap-0.5">
                  {#if backup.status === "running"}
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={act.pending}
                      onclick={() => void act.run(() => cancelBackup(backup.id))}
                    >
                      {t("common.cancel")}
                    </Button>
                  {:else}
                    {#if backup.status === "done"}
                      <Button variant="outline" size="xs" onclick={() => (restoring = backup)}>
                        <Icon icon={RestoreIcon} size={12} />
                        {t("backups.restore")}
                      </Button>
                      <a
                        class="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover hover:text-text"
                        href={backupDownloadUrl(backup.id)}
                        download
                        aria-label={t("backups.download")}
                        data-tooltip={t("backups.download")}
                      >
                        <Icon icon={DownloadIcon} size={12} />
                      </a>
                    {/if}
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      active={backup.pinned}
                      disabled={act.pending}
                      data-tooltip={backup.pinned ? t("backups.unpin") : t("backups.pin")}
                      onclick={() => void act.run(() => setBackupPinned(backup.id, !backup.pinned))}
                    >
                      <Icon icon={backup.pinned ? LockIcon : LockOpenIcon} size={12} />
                    </Button>
                    <Button
                      variant="danger-ghost"
                      size="icon-xs"
                      data-tooltip={t("common.delete")}
                      onclick={() => (deleting = backup)}
                    >
                      <Icon icon={backup.status === "done" ? TrashIcon : CloseIcon} size={12} />
                    </Button>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

{#if choosingScope}
  <BackupScopeDialog
    connectionId={connection.id}
    onStarted={() => backups.reload()}
    onClose={() => (choosingScope = false)}
  />
{/if}

{#if deleting}
  {@const target = deleting}
  <ConfirmDialog
    title={t("backups.deleteTitle")}
    message={t("backups.deleteMessage", { date: when(target.startedAt) })}
    confirmLabel={t("common.delete")}
    danger="danger"
    pending={remove.pending}
    error={remove.error}
    onConfirm={() => void remove.run(target)}
    onCancel={() => (deleting = null)}
  />
{/if}

{#if restoring}
  <RestoreDialog
    backup={restoring}
    source={connection}
    onClose={() => {
      restoring = null;
      backups.reload();
    }}
  />
{/if}
