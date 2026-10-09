import crypto from "node:crypto";
import {
  MONITOR_INTERVALS,
  MONITOR_MUTE_MINUTES,
  type DriftAcknowledgement,
  type DriftEvent,
  type MonitorMute,
  type MonitorSettings,
} from "@nebuladb/shared";
import { db } from "../../infrastructure/db.js";
import { ApiError } from "../../shared/errors.js";

const DEFAULTS: MonitorSettings = { enabled: false, intervalMinutes: 60, ignoreTables: [], lastCheckedAt: null };
const MAX_IGNORED = 200;

interface SettingsRow {
  enabled: number;
  interval_minutes: number;
  ignore_json: string;
  last_checked_at: string | null;
  muted_until: string | null;
  muted_at: string | null;
  muted_by_name: string | null;
  muted_reason: string | null;
}

const MAX_MUTE_REASON = 200;

/** Server time as the database stores it (`YYYY-MM-DD HH:MM:SS`, UTC), so stored dates compare as text. */
function serverTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

/** What the project itself chose, before any connection imposes anything. */
function storedSettings(projectId: string): MonitorSettings {
  const row = db
    .prepare(
      `SELECT enabled, interval_minutes, ignore_json, last_checked_at, muted_until, muted_at, muted_by_name, muted_reason
         FROM monitor_settings WHERE project_id = ?`,
    )
    .get(projectId) as SettingsRow | undefined;
  if (!row) return { ...DEFAULTS };
  return {
    enabled: row.enabled === 1,
    intervalMinutes: row.interval_minutes,
    ignoreTables: JSON.parse(row.ignore_json) as string[],
    lastCheckedAt: row.last_checked_at,
    // A mute that has run out is no mute.
    mute:
      row.muted_until && row.muted_until > serverTime(Date.now())
        ? {
            until: row.muted_until,
            at: row.muted_at ?? row.muted_until,
            by: row.muted_by_name ?? "",
            reason: row.muted_reason ?? "",
          }
        : null,
  };
}

/** Whether the project's alerts are held back right now. */
export function isMuted(projectId: string): boolean {
  return storedSettings(projectId).mute != null;
}

/** Checks what an administrator sent to mute the alerts: one of the offered durations and a reason. */
export function parseMute(body: unknown): { minutes: number; reason: string } {
  const raw = (body ?? {}) as Record<string, unknown>;
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  if (!MONITOR_MUTE_MINUTES.includes(raw.minutes as number) || !reason || reason.length > MAX_MUTE_REASON) {
    throw new ApiError("MONITORING_MUTE_INVALID");
  }
  return { minutes: raw.minutes as number, reason };
}

export function setMute(projectId: string, minutes: number, reason: string, by: string): MonitorMute {
  const now = Date.now();
  const mute = { until: serverTime(now + minutes * 60_000), at: serverTime(now), by, reason };
  db.prepare(
    `INSERT INTO monitor_settings (project_id, muted_until, muted_at, muted_by_name, muted_reason) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       muted_until = excluded.muted_until, muted_at = excluded.muted_at,
       muted_by_name = excluded.muted_by_name, muted_reason = excluded.muted_reason`,
  ).run(projectId, mute.until, mute.at, by, reason);
  return mute;
}

/** Lifts the mute; `false` when there was none. */
export function clearMute(projectId: string): boolean {
  if (!isMuted(projectId)) return false;
  db.prepare(
    "UPDATE monitor_settings SET muted_until = NULL, muted_at = NULL, muted_by_name = NULL, muted_reason = NULL WHERE project_id = ?",
  ).run(projectId);
  return true;
}

/** The watch imposed on a project by the connections it is attached to (Admin → Connexions), or `null`. */
export function forcedMonitoring(projectId: string): NonNullable<MonitorSettings["forced"]> | null {
  const rows = db
    .prepare(
      `SELECT c.name, c.monitor_interval_minutes AS minutes FROM project_connection_links l
         JOIN db_connections c ON c.id = l.connection_id
        WHERE l.project_id = ? AND c.monitor_forced = 1 ORDER BY c.name COLLATE NOCASE`,
    )
    .all(projectId) as { name: string; minutes: number }[];
  if (rows.length === 0) return null;
  return { intervalMinutes: Math.min(...rows.map((row) => row.minutes)), connections: rows.map((row) => row.name) };
}

/** The watch as it runs: the project's own choice, tightened by what its connections impose. */
export function getMonitorSettings(projectId: string): MonitorSettings {
  const stored = storedSettings(projectId);
  const forced = forcedMonitoring(projectId);
  if (!forced) return { ...stored, forced: null };
  return {
    ...stored,
    enabled: true,
    intervalMinutes: stored.enabled ? Math.min(stored.intervalMinutes, forced.intervalMinutes) : forced.intervalMinutes,
    forced,
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
  // Imposed from a connection: on/off and the pace are not the project's any more, and what it
  // had chosen is kept for the day the connection lets go.
  if (forcedMonitoring(projectId)) {
    const stored = storedSettings(projectId);
    settings = { ...settings, enabled: stored.enabled, intervalMinutes: stored.intervalMinutes };
  }
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

/** Projects whose watch is on — by their own choice or a connection's — and whose interval has run out since their last check. */
export function listDueProjects(): string[] {
  return (
    db
      .prepare(
        `SELECT p.id AS project_id FROM projects p
           LEFT JOIN monitor_settings m ON m.project_id = p.id
           LEFT JOIN (SELECT l.project_id, MIN(c.monitor_interval_minutes) AS minutes
                        FROM project_connection_links l JOIN db_connections c ON c.id = l.connection_id
                       WHERE c.monitor_forced = 1 GROUP BY l.project_id) f ON f.project_id = p.id
          WHERE p.status = 'active' AND (m.enabled = 1 OR f.minutes IS NOT NULL)
            AND (m.last_checked_at IS NULL
                 OR m.last_checked_at <= datetime('now', '-' || MIN(
                      CASE WHEN m.enabled = 1 THEN m.interval_minutes ELSE 1000000 END,
                      COALESCE(f.minutes, 1000000)) || ' minutes'))
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
  acknowledged_at: string | null;
  acknowledged_by_name: string | null;
  acknowledged_note: string | null;
}

function acknowledgementOf(row: EventRow): DriftAcknowledgement | null {
  if (!row.acknowledged_at) return null;
  return { by: row.acknowledged_by_name ?? "", at: row.acknowledged_at, note: row.acknowledged_note };
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
    acknowledgement: acknowledgementOf(row),
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

/** One finding of a project, with its connection's name. */
export function getDriftEvent(projectId: string, eventId: string): DriftEvent | null {
  const row = db
    .prepare(
      `SELECT e.*, c.name AS connection_name FROM drift_events e
         LEFT JOIN db_connections c ON c.id = e.connection_id
        WHERE e.project_id = ? AND e.id = ?`,
    )
    .get(projectId, eventId) as EventRow | undefined;
  return row ? rowToEvent(row) : null;
}

/** Records who took note of an open finding, and when. `false` when it is not open or already acknowledged. */
export function acknowledgeDriftEvent(projectId: string, eventId: string, by: string, note: string | null): boolean {
  return (
    db
      .prepare(
        `UPDATE drift_events SET acknowledged_at = datetime('now'), acknowledged_by_name = ?, acknowledged_note = ?
          WHERE project_id = ? AND id = ? AND status = 'open' AND acknowledged_at IS NULL`,
      )
      .run(by, note, projectId, eventId).changes > 0
  );
}

/**
 * The acknowledgement that currently quiets a database's banner: the newest open change
 * (`external` / `partial-deployment`) carries one, and it is not older than the out-of-schema
 * mark — a change made from the console since (which moves the mark) is not covered by it.
 */
export function currentAcknowledgement(
  projectId: string,
  connectionId: string,
  outOfSchemaAt: string | null,
): DriftAcknowledgement | null {
  if (!outOfSchemaAt) return null;
  const row = db
    .prepare(
      `SELECT * FROM drift_events
        WHERE project_id = ? AND connection_id = ? AND status = 'open' AND kind IN ('external', 'partial-deployment')
        ORDER BY detected_at DESC, rowid DESC LIMIT 1`,
    )
    .get(projectId, connectionId) as EventRow | undefined;
  const acknowledgement = row ? acknowledgementOf(row) : null;
  return acknowledgement && acknowledgement.at >= outOfSchemaAt ? acknowledgement : null;
}
