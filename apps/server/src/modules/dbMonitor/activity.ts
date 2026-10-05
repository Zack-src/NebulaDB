import crypto from "node:crypto";
import type {
  DatabaseConnectionConfig,
  DbActivityEntry,
  DbActivityWatch,
  DbAdminSession,
  DbServerCounters,
  DbTrafficBucket,
} from "@athanordb/shared";
import { asUnattended } from "../../infrastructure/actor.js";
import { db } from "../../infrastructure/db.js";
import { getConnectionById } from "../connections/repository.js";
import { createAdminDriver } from "../dbAdmin/drivers/index.js";
import { normalizeSql } from "../dbAdmin/sqlShape.js";

/**
 * Level 1 of the database-side logs: what the database server itself says
 * is connected and running (`pg_stat_activity`, `PROCESSLIST`, DMVs,
 * `V$SESSION` — read through the console's `listSessions`), whoever opened
 * the session, Athanor or not. A sample is a snapshot: a statement that
 * starts and ends between two samples is not seen, and the page says so.
 *
 * Kept per connection, session fingerprint (account, database, client,
 * statement shape) and UTC day — not one row per sample. The statement has
 * every literal replaced by `?`. Athanor reads, never configures anything on
 * the server (level 2, an audit trail, stays the administrator's to set up).
 */

/** What reads the sessions; an object so a test can replace the one step that needs a live server. */
export const activityReader = {
  async read(connection: DatabaseConnectionConfig): Promise<DbAdminSession[]> {
    // The service account does this, even when an administrator asked: the answer is about the server.
    return asUnattended(async () => {
      const driver = await createAdminDriver(connection, "admin");
      try {
        return await driver.listSessions();
      } finally {
        await driver.close().catch(() => {});
      }
    });
  },

  async counters(connection: DatabaseConnectionConfig): Promise<DbServerCounters> {
    return asUnattended(async () => {
      const driver = await createAdminDriver(connection, "admin");
      try {
        return await driver.readCounters();
      } finally {
        await driver.close().catch(() => {});
      }
    });
  },
};

export const SAMPLE_EVERY_MINUTES = 5;
const MAX_ROWS = 500;

/** Adds what the server shows right now to today's rows; returns how many sessions it saw. */
export async function sampleActivity(connection: DatabaseConnectionConfig): Promise<number> {
  const sessions = await activityReader.read(connection);
  const upsert = db.prepare(
    `INSERT INTO db_activity (connection_id, fingerprint, day, db_user, database_name, client, state, normalized_sql,
                              seen, max_seconds, first_at, last_at)
     VALUES (?, ?, date('now'), ?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))
     ON CONFLICT(connection_id, fingerprint, day) DO UPDATE SET
       seen = seen + 1,
       max_seconds = MAX(max_seconds, excluded.max_seconds),
       state = excluded.state,
       last_at = excluded.last_at`,
  );
  db.transaction(() => {
    for (const session of sessions) {
      // A session with no statement is still a connection worth showing; it has an empty shape.
      const shape = session.query ? normalizeSql(session.query, connection.engine) : "";
      const fingerprint = crypto
        .createHash("sha256")
        .update([session.user, session.database, session.client, shape].join("\u0000"))
        .digest("hex")
        .slice(0, 32);
      upsert.run(
        connection.id,
        fingerprint,
        session.user,
        session.database,
        session.client,
        session.state,
        shape,
        Math.max(0, session.durationSeconds ?? 0),
      );
    }
  })();
  // The traffic counters ride along; an engine or account that cannot give them does not fail the sample.
  try {
    const counters = await activityReader.counters(connection);
    db.prepare(
      `INSERT OR REPLACE INTO db_counter_samples (connection_id, taken_at, queries, queries_kind, bytes_out, bytes_in, rows_read)
       VALUES (?, datetime('now'), ?, ?, ?, ?, ?)`,
    ).run(connection.id, counters.queries, counters.queriesKind, counters.bytesOut, counters.bytesIn, counters.rows);
  } catch {
    // Unavailable: the traffic view says so.
  }
  db.prepare(
    `INSERT INTO db_activity_watch (connection_id, enabled, last_sampled_at) VALUES (?, 0, datetime('now'))
     ON CONFLICT(connection_id) DO UPDATE SET last_sampled_at = datetime('now'), last_error = NULL`,
  ).run(connection.id);
  return sessions.length;
}

/** The accounts Athanor itself signs in with on this connection: the service account and the personal ones given. */
function accountsKnownToAthanor(connection: DatabaseConnectionConfig): Set<string> {
  const names = new Set<string>();
  if (connection.user) names.add(connection.user);
  const rows = db
    .prepare("SELECT username FROM db_connection_credentials WHERE connection_id = ?")
    .all(connection.id) as { username: string }[];
  for (const row of rows) names.add(row.username);
  return names;
}

interface ActivityRow {
  fingerprint: string;
  db_user: string | null;
  database_name: string | null;
  client: string | null;
  state: string | null;
  normalized_sql: string;
  seen: number;
  max_seconds: number;
  first_at: string;
  last_at: string;
}

export function listActivity(
  connection: DatabaseConnectionConfig,
  options: { sinceDays?: number; outsideOnly?: boolean },
): DbActivityEntry[] {
  const known = accountsKnownToAthanor(connection);
  const rows = db
    .prepare(
      `SELECT fingerprint, db_user, database_name, client, state, normalized_sql,
              SUM(seen) AS seen, MAX(max_seconds) AS max_seconds, MIN(first_at) AS first_at, MAX(last_at) AS last_at
         FROM db_activity
        WHERE connection_id = ? AND day >= date('now', ?)
        GROUP BY fingerprint ORDER BY MAX(last_at) DESC LIMIT ?`,
    )
    .all(connection.id, `-${Math.max(0, (options.sinceDays ?? 1) - 1)} days`, MAX_ROWS * 4) as ActivityRow[];
  const entries = rows.map<DbActivityEntry>((row) => ({
    fingerprint: row.fingerprint,
    user: row.db_user,
    database: row.database_name,
    client: row.client,
    state: row.state,
    sql: row.normalized_sql,
    seen: row.seen,
    maxSeconds: row.max_seconds,
    firstAt: row.first_at,
    lastAt: row.last_at,
    // By name only: another application using the same account looks like Athanor here.
    knownAccount: row.db_user !== null && known.has(row.db_user),
  }));
  return (options.outsideOnly ? entries.filter((entry) => !entry.knownAccount) : entries).slice(0, MAX_ROWS);
}

interface CounterRow {
  taken_at: string;
  queries: number | null;
  queries_kind: DbServerCounters["queriesKind"];
  bytes_out: number | null;
  bytes_in: number | null;
  rows_read: number | null;
}

/**
 * Traffic over the last `days`: the difference between consecutive reads of
 * the server's cumulative counters, summed per hour (up to 3 days) or per
 * day. A negative difference means the server restarted: that step is
 * dropped, not guessed. What happened between two reads is attributed to the
 * later one. A counter the engine does not have stays `null`.
 */
export function listTraffic(
  connectionId: string,
  days: number,
): { kind: DbServerCounters["queriesKind"] | null; buckets: DbTrafficBucket[] } {
  const rows = db
    .prepare(
      `SELECT taken_at, queries, queries_kind, bytes_out, bytes_in, rows_read FROM db_counter_samples
        WHERE connection_id = ? AND taken_at >= datetime('now', ?) ORDER BY taken_at`,
    )
    .all(connectionId, `-${days} days`) as CounterRow[];
  // One read before the window gives its first step a start.
  const before = db
    .prepare(
      `SELECT taken_at, queries, queries_kind, bytes_out, bytes_in, rows_read FROM db_counter_samples
        WHERE connection_id = ? AND taken_at < datetime('now', ?) ORDER BY taken_at DESC LIMIT 1`,
    )
    .get(connectionId, `-${days} days`) as CounterRow | undefined;
  const series = before ? [before, ...rows] : rows;
  const hourly = days <= 3;
  const buckets = new Map<string, DbTrafficBucket>();
  const step = (a: number | null, b: number | null) => (a === null || b === null || b < a ? null : b - a);
  const add = (total: number | null, delta: number | null) => (delta === null ? total : (total ?? 0) + delta);
  for (let i = 1; i < series.length; i++) {
    const from = series[i - 1];
    const to = series[i];
    const key = to.taken_at.slice(0, hourly ? 13 : 10) + (hourly ? ":00:00" : " 00:00:00");
    const bucket = buckets.get(key) ?? { start: key, queries: null, bytesOut: null, bytesIn: null, rows: null };
    bucket.queries = add(bucket.queries, step(from.queries, to.queries));
    bucket.bytesOut = add(bucket.bytesOut, step(from.bytes_out, to.bytes_out));
    bucket.bytesIn = add(bucket.bytesIn, step(from.bytes_in, to.bytes_in));
    bucket.rows = add(bucket.rows, step(from.rows_read, to.rows_read));
    buckets.set(key, bucket);
  }
  return {
    kind: series.length > 0 ? series[series.length - 1].queries_kind : null,
    buckets: [...buckets.values()].sort((a, b) => (a.start < b.start ? 1 : -1)),
  };
}

export function getActivityWatch(connectionId: string): DbActivityWatch {
  const row = db
    .prepare("SELECT enabled, last_sampled_at, last_error FROM db_activity_watch WHERE connection_id = ?")
    .get(connectionId) as { enabled: number; last_sampled_at: string | null; last_error: string | null } | undefined;
  return {
    enabled: row?.enabled === 1,
    lastSampledAt: row?.last_sampled_at ?? null,
    lastError: row?.last_error ?? null,
  };
}

export function setActivityWatch(connectionId: string, enabled: boolean): void {
  db.prepare(
    `INSERT INTO db_activity_watch (connection_id, enabled) VALUES (?, ?)
     ON CONFLICT(connection_id) DO UPDATE SET enabled = excluded.enabled`,
  ).run(connectionId, enabled ? 1 : 0);
}

/** The scheduled job: samples each watched connection whose last sample is old enough. Never throws. */
export async function runDueActivitySamples(): Promise<void> {
  const due = db
    .prepare(
      `SELECT connection_id FROM db_activity_watch
        WHERE enabled = 1 AND (last_sampled_at IS NULL OR last_sampled_at <= datetime('now', ?))`,
    )
    .all(`-${SAMPLE_EVERY_MINUTES} minutes`) as { connection_id: string }[];
  for (const { connection_id } of due) {
    const connection = getConnectionById(connection_id);
    if (!connection) continue;
    try {
      await sampleActivity(connection);
    } catch (err) {
      db.prepare(
        "UPDATE db_activity_watch SET last_sampled_at = datetime('now'), last_error = ? WHERE connection_id = ?",
      ).run((err instanceof Error ? err.message : String(err)).slice(0, 300), connection_id);
    }
  }
}

/** Drops the days past the retention and what belongs to deleted connections. `0` keeps everything. */
export function purgeOldActivity(retentionDays: number): number {
  let removed = db
    .prepare("DELETE FROM db_activity WHERE connection_id NOT IN (SELECT id FROM db_connections)")
    .run().changes;
  db.prepare("DELETE FROM db_activity_watch WHERE connection_id NOT IN (SELECT id FROM db_connections)").run();
  db.prepare("DELETE FROM db_counter_samples WHERE connection_id NOT IN (SELECT id FROM db_connections)").run();
  db.prepare("DELETE FROM db_health_samples WHERE connection_id NOT IN (SELECT id FROM db_connections)").run();
  if (retentionDays > 0) {
    removed += db.prepare("DELETE FROM db_activity WHERE day < date('now', ?)").run(`-${retentionDays} days`).changes;
    db.prepare("DELETE FROM db_counter_samples WHERE taken_at < datetime('now', ?)").run(`-${retentionDays} days`);
  }
  return removed;
}
