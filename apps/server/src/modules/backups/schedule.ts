import {
  BACKUP_FREQUENCIES,
  BACKUP_KEEP_MAX,
  nextOccurrence,
  previousOccurrence,
  type BackupFrequency,
  type BackupSchedule,
  type BackupStatus,
} from "@nebuladb/shared";
import { db } from "../../infrastructure/db.js";
import { ApiError } from "../../shared/errors.js";
import { getConnectionById } from "../connections/repository.js";
import { pruneScheduledBackups } from "./repository.js";
import { startBackup } from "./runner.js";

interface ScheduleRow {
  connection_id: string;
  enabled: number;
  frequency: string;
  hour: number;
  weekday: number;
  day_of_month: number;
  keep: number;
  not_before: string;
  last_run_at: string | null;
  last_status: string | null;
}

/** What a connection has before anyone sets anything: off, nightly at 02:00, a week kept. */
const DEFAULTS = { enabled: false, frequency: "daily" as BackupFrequency, hour: 2, weekday: 1, dayOfMonth: 1, keep: 7 };

export type ScheduleSettings = typeof DEFAULTS;

function rowToSchedule(row: ScheduleRow | undefined, now: Date): BackupSchedule {
  const settings: ScheduleSettings = row
    ? {
        enabled: row.enabled === 1,
        frequency: row.frequency as BackupFrequency,
        hour: row.hour,
        weekday: row.weekday,
        dayOfMonth: row.day_of_month,
        keep: row.keep,
      }
    : DEFAULTS;
  return {
    ...settings,
    lastRunAt: row?.last_run_at ?? null,
    lastStatus: (row?.last_status as BackupStatus | null | undefined) ?? null,
    nextRunAt: settings.enabled ? nextOccurrence(settings, now).toISOString() : null,
  };
}

export function getBackupSchedule(connectionId: string, now = new Date()): BackupSchedule {
  const row = db.prepare("SELECT * FROM backup_schedules WHERE connection_id = ?").get(connectionId) as
    ScheduleRow | undefined;
  return rowToSchedule(row, now);
}

function integerIn(value: unknown, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new ApiError("BACKUP_INVALID");
  }
  return value as number;
}

/** Checks what an administrator sent. Every field is required: the form always sends the whole schedule. */
export function parseBackupSchedule(body: unknown): ScheduleSettings {
  const raw = (body ?? {}) as Record<string, unknown>;
  if (typeof raw.enabled !== "boolean") throw new ApiError("BACKUP_INVALID");
  if (!BACKUP_FREQUENCIES.includes(raw.frequency as BackupFrequency)) throw new ApiError("BACKUP_INVALID");
  return {
    enabled: raw.enabled,
    frequency: raw.frequency as BackupFrequency,
    hour: integerIn(raw.hour, 0, 23),
    weekday: integerIn(raw.weekday, 0, 6),
    dayOfMonth: integerIn(raw.dayOfMonth, 1, 28),
    keep: integerIn(raw.keep, 1, BACKUP_KEEP_MAX),
  };
}

/**
 * Saving restarts the clock: `not_before` moves to now, so a schedule set at
 * 15:00 for 02:00 fires next night, not at once for the 02:00 already gone.
 */
export function saveBackupSchedule(
  connectionId: string,
  settings: ScheduleSettings,
  by: string,
  now = new Date(),
): BackupSchedule {
  db.prepare(
    `INSERT INTO backup_schedules
       (connection_id, enabled, frequency, hour, weekday, day_of_month, keep, not_before, updated_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(connection_id) DO UPDATE SET
       enabled = excluded.enabled, frequency = excluded.frequency, hour = excluded.hour, weekday = excluded.weekday,
       day_of_month = excluded.day_of_month, keep = excluded.keep, not_before = excluded.not_before,
       updated_by_name = excluded.updated_by_name`,
  ).run(
    connectionId,
    settings.enabled ? 1 : 0,
    settings.frequency,
    settings.hour,
    settings.weekday,
    settings.dayOfMonth,
    settings.keep,
    now.toISOString(),
    by,
  );
  return getBackupSchedule(connectionId, now);
}

function isDue(row: ScheduleRow, now: Date): boolean {
  const due = previousOccurrence(
    { frequency: row.frequency as BackupFrequency, hour: row.hour, weekday: row.weekday, dayOfMonth: row.day_of_month },
    now,
  );
  // Timestamps here are ISO strings written by this file, so they compare as dates.
  if (due <= new Date(row.not_before)) return false;
  return row.last_run_at === null || due > new Date(row.last_run_at);
}

/**
 * The scheduler's pass: every enabled schedule whose hour has come since its
 * last run gets one backup — one database after the other, so a night's
 * backups do not all read at once. A server that was down at the hour runs
 * the missed backup once when it is back, not once per missed day. The run is
 * recorded before it starts: a crash half-way does not make it start over on
 * every restart.
 */
export async function runDueBackupSchedules(now = new Date()): Promise<number> {
  const rows = db.prepare("SELECT * FROM backup_schedules WHERE enabled = 1").all() as ScheduleRow[];
  const record = db.prepare("UPDATE backup_schedules SET last_run_at = ?, last_status = ? WHERE connection_id = ?");
  let started = 0;
  for (const row of rows.filter((candidate) => isDue(candidate, now))) {
    const connection = getConnectionById(row.connection_id);
    if (!connection) continue;
    record.run(now.toISOString(), "running", row.connection_id);
    try {
      const backup = await startBackup({ connection, trigger: "scheduled" }).done;
      record.run(now.toISOString(), backup.status, row.connection_id);
      if (backup.status === "done") pruneScheduledBackups(row.connection_id, row.keep);
      started++;
    } catch (err) {
      // Another backup of this database is running: this occurrence is skipped, the next one is not.
      record.run(now.toISOString(), "failed", row.connection_id);
      console.error(`[backups] scheduled backup of ${connection.name} did not start:`, err);
    }
  }
  return started;
}
