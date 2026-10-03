<script lang="ts">
  import { BACKUP_FREQUENCIES, BACKUP_KEEP_MAX, type BackupSchedule } from "@athanordb/shared";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import NumberInput from "@/components/ui/NumberInput.svelte";
  import Select from "@/components/ui/Select.svelte";
  import Switch from "@/components/ui/Switch.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { formatDateTime } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { saveBackupSchedule, type BackupScheduleSettings } from "@/services/backupsApi";

  /**
   * "Planification": when this database is backed up on its own, and how many
   * of those backups are kept. Each change is saved as it is made; the next
   * run shown is the server's answer, in the server's own time.
   */
  let {
    connectionId,
    schedule,
    onSaved,
  }: { connectionId: string; schedule: BackupSchedule; onSaved: (schedule: BackupSchedule) => void } = $props();

  const { t } = useTranslation();
  const save = useAsyncAction(async (patch: Partial<BackupScheduleSettings>) => {
    const { enabled, frequency, hour, weekday, dayOfMonth, keep } = schedule;
    onSaved(await saveBackupSchedule(connectionId, { enabled, frequency, hour, weekday, dayOfMonth, keep, ...patch }));
  });

  const frequencyOptions = $derived(
    BACKUP_FREQUENCIES.map((frequency) => ({ value: frequency, label: t(`backups.schedule.frequency.${frequency}`) })),
  );
  const hourOptions = Array.from({ length: 24 }, (_, hour) => ({ value: hour, label: `${String(hour).padStart(2, "0")}:00` }));
  // 2023-01-01 was a Sunday: day `n` of that week is weekday `n`, named in the reader's language.
  const weekdayOptions = $derived(
    Array.from({ length: 7 }, (_, weekday) => ({
      value: weekday,
      label: new Intl.DateTimeFormat(i18n.locale, { weekday: "long" }).format(new Date(2023, 0, 1 + weekday)),
    })),
  );
  const off = $derived(!schedule.enabled || save.pending);
</script>

<div class="mt-3 rounded-md border border-border bg-surface p-3 text-xs" data-testid="backup-schedule">
  <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
    <span class="flex items-center gap-2 font-semibold text-text">
      <Switch
        size="sm"
        checked={schedule.enabled}
        disabled={save.pending}
        onChange={(enabled) => void save.run({ enabled })}
        aria-label={t("backups.schedule.enable")}
      />
      {t("backups.schedule.enable")}
    </span>
    <Select
      size="sm"
      class="w-44"
      aria-label={t("backups.schedule.frequency")}
      value={schedule.frequency}
      options={frequencyOptions}
      disabled={off}
      onChange={(frequency) => void save.run({ frequency })}
    />
    {#if schedule.frequency === "weekly"}
      <Select
        size="sm"
        class="w-32"
        aria-label={t("backups.schedule.weekday")}
        value={schedule.weekday}
        options={weekdayOptions}
        disabled={off}
        onChange={(weekday) => void save.run({ weekday })}
      />
    {:else if schedule.frequency === "monthly"}
      <span class="flex items-center gap-1.5">
        {t("backups.schedule.onDay")}
        <NumberInput
          inputSize="sm"
          class="w-20"
          aria-label={t("backups.schedule.dayOfMonth")}
          value={schedule.dayOfMonth}
          min={1}
          max={28}
          disabled={off}
          onChange={(dayOfMonth) => {
            if (dayOfMonth !== null && dayOfMonth >= 1 && dayOfMonth <= 28) void save.run({ dayOfMonth });
          }}
        />
      </span>
    {/if}
    <span class="flex items-center gap-1.5">
      {t("backups.schedule.at")}
      <Select
        size="sm"
        class="w-24"
        aria-label={t("backups.schedule.hour")}
        value={schedule.hour}
        options={hourOptions}
        disabled={off}
        onChange={(hour) => void save.run({ hour })}
      />
    </span>
    <span class="flex items-center gap-1.5">
      {t("backups.schedule.keep")}
      <NumberInput
        inputSize="sm"
        class="w-20"
        aria-label={t("backups.schedule.keepLabel")}
        value={schedule.keep}
        min={1}
        max={BACKUP_KEEP_MAX}
        disabled={off}
        onChange={(keep) => {
          if (keep !== null && keep >= 1 && keep <= BACKUP_KEEP_MAX) void save.run({ keep });
        }}
      />
      {t("backups.schedule.keepUnit")}
    </span>
  </div>
  <p class="m-0 mt-2 text-text-muted">
    {#if schedule.nextRunAt}
      {t("backups.schedule.next", { date: formatDateTime(schedule.nextRunAt, i18n.locale) })}
    {:else}
      {t("backups.schedule.off")}
    {/if}
    {t("backups.schedule.serverTime")}
    {#if schedule.lastStatus === "failed"}
      <span class="text-danger">{t("backups.schedule.lastFailed")}</span>
    {/if}
  </p>
  {#if save.error}<ErrorText>{save.error}</ErrorText>{/if}
</div>
