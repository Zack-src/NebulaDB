import crypto from "node:crypto";
import { MONITOR_INTERVALS, type DriftEvent, type MonitorSettings } from "@athanordb/shared";
import { db } from "../../infrastructure/db.js";
import { ApiError } from "../../shared/errors.js";

const DEFAULTS: MonitorSettings = { enabled: false, intervalMinutes: 60, ignoreTables: [], lastCheckedAt: null };
const MAX_IGNORED = 200;

interface SettingsRow {
  enabled: number;
  interval_minutes: number;
  ignore_json: string;
  last_checked_at: string | null;
}

export function getMonitorSettings(projectId: string): MonitorSettings {
  const row = db
    .prepare(
      "SELECT enabled, interval_minutes, ignore_json, last_checked_at FROM monitor_settings WHERE project_id = ?",
    )
    .get(projectId) as SettingsRow | undefined;
  if (!row) return { ...DEFAULTS };
  return {
    enabled: row.enabled === 1,
    intervalMinutes: row.interval_minutes,
    ignoreTables: JSON.parse(row.ignore_json) as string[],
    lastCheckedAt: row.last_checked_at,
  };
}

/** Checks what an administrator sent: a known interval, a list of table names. */
export function parseMonitorSettings(body: unknown): Omit<MonitorSettings, "lastCheckedAt"> {
  const raw = (body ?? {}) as Record<string, unknown>;
  if (typeof raw.enabled !== "boolean") throw new ApiError("MONITORING_INVALID");
  if (!MONITOR_INTERVALS.includes(raw.intervalMinutes as number)) throw new ApiError("MONITORING_INVALID");
  const ignore = raw.ignoreTables ?? [];
  if (
    !Array.isArray(ignore) ||
    ignore.length > MAX_IGNORED ||
    !ignore.every((name) => typeof name === "string" && name.trim().length > 0 && name.length <= 128)
  ) {
    throw new ApiError("MONITORING_INVALID");
  }
  return {
    enabled: raw.enabled,
    intervalMinutes: raw.intervalMinutes as number,
    ignoreTables: [...new Set((ignore as string[]).map((name) => name.trim()))],
  };
}

export function saveMonitorSettings(
  projectId: string,
  settings: Omit<MonitorSettings, "lastCheckedAt">,
  by: string,
): MonitorSettings {
  db.prepare(
    `INSERT INTO monitor_settings (project_id, enabled, interval_minutes, ignore_json, updated_by_name, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(project_id) DO UPDATE SET
       enabled = excluded.enabled, interval_minutes = excluded.interval_minutes, ignore_json = excluded.ignore_json,
       updated_by_name = excluded.updated_by_name, updated_at = excluded.updated_at`,
  ).run(projectId, settings.enabled ? 1 : 0, settings.intervalMinutes, JSON.stringify(settings.ignoreTables), by);
  return getMonitorSettings(projectId);
}

export function markChecked(projectId: string): void {
  db.prepare(
    `INSERT INTO monitor_settings (project_id, last_checked_at) VALUES (?, datetime('now'))
     ON CONFLICT(project_id) DO UPDATE SET last_checked_at = datetime('now')`,
  ).run(projectId);
}

/** Projects whose watch is on and whose interval has run out since their last check. */
export function listDueProjects(): string[] {
  return (
    db
      .prepare(
        `SELECT m.project_id FROM monitor_settings m JOIN projects p ON p.id = m.project_id
          WHERE m.enabled = 1 AND p.status = 'active'
            AND (m.last_checked_at IS NULL
                 OR m.last_checked_at <= datetime('now', '-' || m.interval_minutes || ' minutes'))
          ORDER BY m.last_checked_at`,
      )
      .all() as { project_id: string }[]
  ).map((row) => row.project_id);
}

interface EventRow {
  id: string;
  connection_id: string;
  connection_name: string | null;
  kind: DriftEvent["kind"];
  detected_at: string;
  added_json: string;
  removed_json: string;
  changed_json: string;
  error: string | null;
  status: DriftEvent["status"];
  resolved_at: string | null;
  details_json: string | null;
}

function rowToEvent(row: EventRow): DriftEvent {
  const event: DriftEvent = {
    id: row.id,
    connectionId: row.connection_id,
    connectionName: row.connection_name,
    kind: row.kind,
    detectedAt: row.detected_at,
    added: JSON.parse(row.added_json) as string[],
    removed: JSON.parse(row.removed_json) as string[],
    changed: JSON.parse(row.changed_json) as string[],
    error: row.error,
    status: row.status,
    resolvedAt: row.resolved_at,
  };
  if (row.kind === "accounts") event.accountChanges = row.details_json ? JSON.parse(row.details_json) : [];
  return event;
}

/**
 * A project's findings, newest first. Those of the accounts watch name the
 * database's accounts: only listed when the caller may see them (`withAccounts`).
 */
export function listDriftEvents(projectId: string, limit = 50, withAccounts = false): DriftEvent[] {
  return (
    db
      .prepare(
        `SELECT e.*, c.name AS connection_name FROM drift_events e
           LEFT JOIN db_connections c ON c.id = e.connection_id
          WHERE e.project_id = ? ${withAccounts ? "" : "AND e.kind <> 'accounts'"}
          ORDER BY e.detected_at DESC, e.rowid DESC LIMIT ?`,
      )
      .all(projectId, limit) as EventRow[]
  ).map(rowToEvent);
}

/** Whether this exact state of the database was already reported (still open, or waved off). */
export function alreadyReported(projectId: string, connectionId: string, liveHash: string): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM drift_events
          WHERE project_id = ? AND connection_id = ? AND live_hash = ? AND status IN ('open', 'ignored') LIMIT 1`,
      )
      .get(projectId, connectionId, liveHash) !== undefined
  );
}

export function hasOpenUnreachable(projectId: string, connectionId: string): boolean {
  return (
    db
      .prepare(
        "SELECT 1 FROM drift_events WHERE project_id = ? AND connection_id = ? AND kind = 'unreachable' AND status = 'open'",
      )
      .get(projectId, connectionId) !== undefined
  );
}

export function insertDriftEvent(input: {
  projectId: string;
  connectionId: string;
  kind: DriftEvent["kind"];
  liveHash?: string | null;
  added?: string[];
  removed?: string[];
  changed?: string[];
  error?: string | null;
  /** What an `accounts` event means, as `AccountChange`s. */
  details?: unknown;
}): string {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO drift_events (id, project_id, connection_id, kind, live_hash, added_json, removed_json, changed_json, error, details_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.projectId,
    input.connectionId,
    input.kind,
    input.liveHash ?? null,
    JSON.stringify(input.added ?? []),
    JSON.stringify(input.removed ?? []),
    JSON.stringify(input.changed ?? []),
    input.error?.slice(0, 500) ?? null,
    input.details === undefined ? null : JSON.stringify(input.details),
  );
  return id;
}

/** Closes open events for a database: `resolved` when schema and database agree again, `ignored` when waved off. */
export function closeDriftEvents(
  projectId: string,
  connectionId: string,
  status: "resolved" | "ignored",
  kinds: DriftEvent["kind"][] = ["external", "partial-deployment", "unreachable"],
): number {
  return db
    .prepare(
      `UPDATE drift_events SET status = ?, resolved_at = datetime('now')
        WHERE project_id = ? AND connection_id = ? AND status = 'open'
          AND kind IN (${kinds.map(() => "?").join(", ")})`,
    )
    .run(status, projectId, connectionId, ...kinds).changes;
}
