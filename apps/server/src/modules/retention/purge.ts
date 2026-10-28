import { db } from "../../infrastructure/db.js";
import {
  RETENTION_POLICIES,
  type RetentionDateFormat,
  type RetentionPolicy,
  type RetentionTarget,
} from "./registry.js";
import { allEffectiveRetentions, writePurgeState } from "./settings.js";

/**
 * The purge itself: each journal in batches, so a large backlog never holds a
 * long lock on a table the application writes to. A batch picks the rows by
 * physical address (`ctid`), which works whatever the table's key (some are
 * composite, some have none), and is exact within one statement: the
 * subquery and the DELETE share their snapshot.
 *
 * A journal is purged by one process at a time (an advisory lock per
 * journal): the scheduled pass skips a journal someone is purging by hand,
 * and a manual purge is refused while the scheduled one is on it.
 */

export const RETENTION_LOCK_SPACE = 7_265_003;
export const DEFAULT_BATCH_SIZE = 5000;
/** Breathing room between batches, so other queries get the table in between. */
const PAUSE_BETWEEN_BATCHES_MS = 50;
/** A backstop against a statement that keeps finding rows (it cannot, but a loop must end). */
const MAX_BATCHES = 10_000;

export interface PurgeOptions {
  batchSize?: number;
  pauseMs?: number;
}

export interface PurgeResult {
  key: string;
  deleted: number;
  /** For a days journal: rows dated before this went (in the journal's own date format). */
  cutoff: string | null;
  /** How many batches it took (statements that deleted something). */
  batches: number;
}

/** The `YYYY-MM-DD HH:MM:SS` UTC form every other date of the API uses. */
export const nowUtc = () => new Date().toISOString().slice(0, 19).replace("T", " ");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The cutoff `days` ago by the database's clock, as each date format writes it. */
async function cutoffFor(days: number): Promise<Record<RetentionDateFormat, string>> {
  const row = (await db
    .prepare("SELECT utc_now(?::interval) AS ts, utc_today(?::interval) AS day")
    .get(`-${days} days`, `-${days} days`)) as { ts: string; day: string };
  return { timestamp: row.ts, day: row.day, iso: row.ts.replace(" ", "T") };
}

interface Candidates {
  table: string;
  /** Selects the `ctid` of every row to delete. */
  sql: string;
  params: unknown[];
}

function targetCandidates(target: RetentionTarget, cutoff: string | null): Candidates | null {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (cutoff !== null) {
    const purgeable = [`t.${target.dateColumn} < ?`, ...(target.purgeableWhere ? [target.purgeableWhere] : [])];
    conditions.push(`(${purgeable.join(" AND ")})`);
    params.push(cutoff);
  }
  if (target.orphanWhere) conditions.push(`(${target.orphanWhere})`);
  if (conditions.length === 0) return null;
  return {
    table: target.table,
    sql: `SELECT t.ctid FROM ${target.table} t WHERE ${conditions.join(" OR ")}`,
    params,
  };
}

/** What a purge at `value` would delete, statement by statement. */
async function candidatesFor(
  policy: RetentionPolicy,
  value: number,
): Promise<{ candidates: Candidates[]; cutoff: string | null }> {
  if (policy.unit === "rows") {
    const partition = policy.partitionBy.length > 0 ? `PARTITION BY ${policy.partitionBy.join(", ")} ` : "";
    return {
      cutoff: null,
      candidates: [
        {
          table: policy.table,
          sql:
            `SELECT k.ctid FROM (SELECT ctid, row_number() OVER (${partition}ORDER BY ${policy.orderBy}) AS rn` +
            ` FROM ${policy.table}) k WHERE k.rn > ?`,
          params: [value],
        },
      ],
    };
  }
  const cutoffs = value > 0 ? await cutoffFor(value) : null;
  const candidates = policy.targets
    .map((target) => targetCandidates(target, cutoffs ? cutoffs[target.dateFormat] : null))
    .filter((c): c is Candidates => c !== null);
  return { candidates, cutoff: cutoffs ? cutoffs[policy.targets[0].dateFormat] : null };
}

async function deleteInBatches(candidates: Candidates, batchSize: number, pauseMs: number) {
  const statement = db.prepare(
    `DELETE FROM ${candidates.table} WHERE ctid = ANY(ARRAY(${candidates.sql} LIMIT ${batchSize}))`,
  );
  let deleted = 0;
  let batches = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const changes = (await statement.run(...candidates.params)).changes;
    if (changes === 0) break;
    deleted += changes;
    batches++;
    if (changes < batchSize) break;
    if (pauseMs > 0) await sleep(pauseMs);
  }
  return { deleted, batches };
}

/**
 * Purges one journal down to `value` (days, or rows kept). `0` keeps
 * everything, but rows left by deleted connections still go. Does not take
 * the lock, read the setting or record anything: see `purgeJournalNow` and
 * `runRetention`.
 */
export async function purgeJournal(
  policy: RetentionPolicy,
  value: number,
  options: PurgeOptions = {},
): Promise<PurgeResult> {
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? DEFAULT_BATCH_SIZE));
  const pauseMs = options.pauseMs ?? PAUSE_BETWEEN_BATCHES_MS;
  for (const statement of policy.cleanup ?? []) await db.prepare(statement).run();
  if (policy.unit === "rows" && value <= 0) return { key: policy.key, deleted: 0, cutoff: null, batches: 0 };
  const { candidates, cutoff } = await candidatesFor(policy, value);
  let deleted = 0;
  let batches = 0;
  for (const target of candidates) {
    const result = await deleteInBatches(target, batchSize, pauseMs);
    deleted += result.deleted;
    batches += result.batches;
  }
  return { key: policy.key, deleted, cutoff, batches };
}

/** How many rows a purge at `value` would delete now, and the cutoff it would use. */
export async function previewPurge(
  policy: RetentionPolicy,
  value: number,
): Promise<{ rows: number; cutoff: string | null }> {
  if (policy.unit === "rows" && value <= 0) return { rows: 0, cutoff: null };
  const { candidates, cutoff } = await candidatesFor(policy, value);
  let rows = 0;
  for (const target of candidates) {
    const row = (await db.prepare(`SELECT count(*)::int AS n FROM (${target.sql}) c`).get(...target.params)) as {
      n: number;
    };
    rows += row.n;
  }
  return { rows, cutoff };
}

/** Runs `work` holding the journal's purge lock; `null` when someone else holds it. */
export async function withJournalLock<T>(key: string, work: () => Promise<T>): Promise<T | null> {
  const release = await db.tryAdvisoryLock(RETENTION_LOCK_SPACE, key);
  if (!release) return null;
  try {
    return await work();
  } finally {
    await release();
  }
}

/**
 * The scheduled pass: every journal at its effective retention. One journal
 * failing does not stop the others. Returns what each journal did (journals
 * skipped because a manual purge held them are left out).
 */
export async function runRetention(options: PurgeOptions = {}): Promise<PurgeResult[]> {
  const retentions = await allEffectiveRetentions();
  const results: PurgeResult[] = [];
  for (const policy of RETENTION_POLICIES) {
    const value = retentions.get(policy.key)!.value;
    try {
      const result = await withJournalLock(policy.key, () => purgeJournal(policy, value, options));
      if (!result) continue;
      results.push(result);
      await writePurgeState(policy.key, {
        at: nowUtc(),
        deleted: result.deleted,
        cutoff: result.cutoff,
        trigger: "scheduled",
      });
    } catch (err) {
      console.error(`[retention] purge of ${policy.key} failed:`, err);
    }
  }
  return results;
}
