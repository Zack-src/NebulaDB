import type { DatabaseEngine, Id } from "./schema.js";

/**
 * Logical backups of a connected database: Athanor reads structure and rows
 * through the driver and keeps them in one encrypted file. Types shared by
 * the server (`modules/backups/`) and the "Sauvegardes" tab.
 */

/** Why a backup was taken. The two `pre-*` ones are the safety copy made before Athanor writes to the database. */
export type BackupTrigger = "manual" | "pre-deployment" | "pre-restore";

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
}

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
  format: "athanordb-backup";
  version: 1;
  engine: DatabaseEngine;
  connectionName: string;
  createdAt: string;
  tables: string[];
}

export type BackupCell = string | null | { $b: string };
