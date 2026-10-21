import type { DatabaseEngine, Id } from "./schema.js";

/**
 * Logical backups of a connected database: Nebula reads structure and rows
 * through the driver and keeps them in one encrypted file. Types shared by
 * the server (`modules/backups/`) and the "Sauvegardes" tab.
 */

/** Why a backup was taken. `scheduled`: the connection's schedule. The two `pre-*` ones are the safety copy made before Nebula writes to the database. */
export type BackupTrigger = "manual" | "scheduled" | "pre-deployment" | "pre-restore";

export type BackupStatus = "running" | "done" | "failed" | "cancelled";

export interface BackupTableInfo {
  name: string;
  columns: string[];
  rows: number;
}

export interface BackupSummary {
  id: Id;
  connectionId: Id | null;
  connectionName: string;
  engine: DatabaseEngine;
  trigger: BackupTrigger;
  status: BackupStatus;
  /** The tables asked for; `null` means the whole database. */
  scope: string[] | null;
  /** Tables written so far (all of them once `done`), in the order they are stored: parents before children. */
  tables: BackupTableInfo[];
  /** How many tables the backup covers — with `tables.length`, the progress of a running one. */
  tablesTotal: number;
  rows: number;
  /** Size of the stored file (compressed, encrypted); `null` until it is finished. */
  sizeBytes: number | null;
  /** SHA-256 of the stored file. */
  checksum: string | null;
  error: string | null;
  note: string | null;
  createdByName: string | null;
  startedAt: string;
  finishedAt: string | null;
  /** A pinned backup is never removed by the retention sweep. */
  pinned: boolean;
  /** When the retention sweep will remove it; `null` when it never will (pinned, or retention off). */
  expiresAt: string | null;
  /** Where the file was written, as it was then — whatever the connection's destination is now. */
  storage: BackupStorageLocation;
}

/** Which kind of place a backup file is kept in. */
export type BackupDestinationKind = "local" | "s3" | "sftp";

/** Where one backup is stored, for display: never a credential. `location`: a folder, `s3://bucket/prefix`, `sftp://user@host:port/folder`. */
export interface BackupStorageLocation {
  kind: BackupDestinationKind;
  location: string;
}

export interface BackupLimits {
  /** Ceiling on the data read for one backup, before compression. */
  maxBytes: number;
  /** Days a backup is kept; 0 keeps them until someone deletes them. */
  retentionDays: number;
}

export interface BackupList {
  backups: BackupSummary[];
  limits: BackupLimits;
  /** Disk space taken by this connection's stored backups. */
  usedBytes: number;
  schedule: BackupSchedule;
  destination: BackupDestination;
}

/** An S3-compatible bucket (AWS S3, MinIO, Scaleway, OVH…). The keys are credentials, kept apart. */
export interface S3DestinationSettings {
  /** Base URL of the service; empty for AWS S3 itself. */
  endpoint: string;
  region: string;
  bucket: string;
  /** Folder-like key prefix inside the bucket; may be empty. */
  prefix: string;
  /** `endpoint/bucket/key` instead of `bucket.endpoint/key`: what MinIO and most self-hosted stores want. */
  pathStyle: boolean;
}

/** An SFTP server. The password or private key is a credential, kept apart. */
export interface SftpDestinationSettings {
  host: string;
  port: number;
  username: string;
  remoteDir: string;
  /** The server's host key as `ssh-keygen -lf` prints it (`SHA256:…`): required, and checked on every connection. */
  hostKeyFingerprint: string;
}

/**
 * Where a connection's backups are written: a folder of the server — local or
 * a mounted network share (`directory`, `null` for the instance's own, which
 * `defaultDirectory` names) — or a remote store. Credentials are never part of
 * it: `hasCredentials` says they are saved.
 */
export interface BackupDestination {
  kind: BackupDestinationKind;
  directory: string | null;
  defaultDirectory: string;
  s3: S3DestinationSettings | null;
  sftp: (SftpDestinationSettings & { authMethod: "password" | "privateKey" }) | null;
  hasCredentials: boolean;
}

/**
 * `PUT /api/admin/connections/:id/backup-destination`. A credential left out
 * (or empty) keeps the one already saved for this connection's remote.
 */
export type BackupDestinationInput =
  | { kind: "local"; directory: string | null }
  | { kind: "s3"; s3: S3DestinationSettings & { accessKeyId?: string; secretAccessKey?: string } }
  | {
      kind: "sftp";
      sftp: SftpDestinationSettings & { password?: string; privateKey?: string; passphrase?: string };
    };

/** What a restore did to one table. */
export interface RestoreTableResult {
  name: string;
  /** Rows removed from the target before the backup's rows went in. */
  deleted: number | null;
  inserted: number;
  error?: string;
}

export interface RestoreResult {
  success: boolean;
  tables: RestoreTableResult[];
  /** The copy of the target's current rows taken just before; `null` when it was explicitly skipped. */
  safetyBackupId: Id | null;
}

/**
 * The first line of a backup file — one JSON document per line: this header,
 * then for each table a `{ table, columns }` line, its rows as arrays, and an
 * `{ end, rows }` line. A cell is text as the engine prints it, `null`, or
 * `{ $b: "<base64>" }` for bytes.
 */
export interface BackupFileHeader {
  format: "nebuladb-backup" | "athanordb-backup";
  version: 1;
  engine: DatabaseEngine;
  connectionName: string;
  createdAt: string;
  tables: string[];
}

export type BackupCell = string | null | { $b: string };

export type BackupFrequency = "daily" | "weekly" | "monthly";

export const BACKUP_FREQUENCIES: readonly BackupFrequency[] = ["daily", "weekly", "monthly"];

/** How many scheduled backups a schedule may keep. */
export const BACKUP_KEEP_MAX = 365;

/** When a schedule fires. Times are the server's local time: the hour an operator reads on the machine's clock. */
export interface BackupScheduleTiming {
  frequency: BackupFrequency;
  /** Hour of the day, 0–23. */
  hour: number;
  /** Day of the week for `weekly`, 0 = Sunday. */
  weekday: number;
  /** Day of the month for `monthly`, 1–28 — a day every month has. */
  dayOfMonth: number;
}

/** A connection's backup schedule (`GET/PUT /api/admin/connections/:id/backup-schedule`). */
export interface BackupSchedule extends BackupScheduleTiming {
  enabled: boolean;
  /** Scheduled backups kept; older ones are removed after each run, pinned ones excepted. */
  keep: number;
  lastRunAt: string | null;
  lastStatus: BackupStatus | null;
  /** When it fires next (ISO); `null` when it is off. */
  nextRunAt: string | null;
}

/** The latest instant at or before `now` at which the schedule fires. */
export function previousOccurrence(timing: BackupScheduleTiming, now: Date): Date {
  const at = (year: number, month: number, day: number) => new Date(year, month, day, timing.hour, 0, 0, 0);
  const [year, month, day] = [now.getFullYear(), now.getMonth(), now.getDate()];
  if (timing.frequency === "monthly") {
    const thisMonth = at(year, month, timing.dayOfMonth);
    return thisMonth <= now ? thisMonth : at(year, month - 1, timing.dayOfMonth);
  }
  if (timing.frequency === "weekly") {
    const back = (now.getDay() - timing.weekday + 7) % 7;
    const thisWeek = at(year, month, day - back);
    return thisWeek <= now ? thisWeek : at(year, month, day - back - 7);
  }
  const today = at(year, month, day);
  return today <= now ? today : at(year, month, day - 1);
}

/** The first instant after `now` at which the schedule fires. */
export function nextOccurrence(timing: BackupScheduleTiming, now: Date): Date {
  const previous = previousOccurrence(timing, now);
  const [year, month, day] = [previous.getFullYear(), previous.getMonth(), previous.getDate()];
  if (timing.frequency === "monthly") return new Date(year, month + 1, day, timing.hour);
  return new Date(year, month, day + (timing.frequency === "weekly" ? 7 : 1), timing.hour);
}
