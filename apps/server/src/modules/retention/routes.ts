import type { FastifyInstance } from "fastify";
import { db } from "../../infrastructure/db.js";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin } from "../../shared/guards.js";
import { paramsOf, parseBody, parseParams, z } from "../../shared/validate.js";
import { previewPurge, purgeJournalNow } from "./purge.js";
import {
  RETENTION_POLICIES,
  findRetentionPolicy,
  policyTables,
  retentionValueProblem,
  type RetentionPolicy,
} from "./registry.js";
import {
  allEffectiveRetentions,
  changeRetention,
  effectiveRetention,
  readPurgeStates,
  type EffectiveRetention,
  type RetentionPurgeState,
  type RetentionSource,
} from "./settings.js";

/**
 * The retention policy, for the admin console: instance administrators only,
 * through a browser session (API keys are resolved for `/api/v1/` only, so a
 * key never reaches these routes).
 *
 * - `GET  /api/admin/retention`               → `{ journals: RetentionJournal[] }`
 * - `GET  /api/admin/retention/:key/preview`  → what "purge now" would delete
 * - `PUT  /api/admin/retention/:key`          `{ value: number | null, confirm?: boolean }` → `{ journal }`
 * - `POST /api/admin/retention/:key/purge`    `{ confirm: "<key>" }` → what was deleted
 */

export interface RetentionJournal {
  key: string;
  label: string;
  description: string;
  /** `days`: rows older than `value` days go; `rows`: the latest `value` rows are kept (per user, per connection…). */
  unit: "days" | "rows";
  /** In force now; `0` = kept forever. */
  value: number;
  source: RetentionSource;
  defaultValue: number;
  envVar: string | null;
  envValue: number | null;
  min: number;
  max: number;
  allowForever: boolean;
  /** Setting a value below this needs `confirm: true`. */
  confirmBelow: number | null;
  /** Who set the administrator's value, and when; `null` without one. */
  updatedBy: { id: string; email: string | null } | null;
  updatedAt: string | null;
  tables: string[];
  rows: number;
  /** On-disk size of the tables, indexes included. */
  bytes: number;
  /** `YYYY-MM-DD HH:MM:SS` (or `YYYY-MM-DD` for a journal kept by day). */
  oldest: string | null;
  lastPurge: RetentionPurgeState | null;
}

/** An ISO date shown like every other date of the API. */
const normalizeDate = (value: string | null) => (value ? value.slice(0, 19).replace("T", " ") : null);

async function journalVolume(policy: RetentionPolicy) {
  let rows = 0;
  let bytes = 0;
  for (const table of policyTables(policy)) {
    const row = (await db
      .prepare(`SELECT count(*)::bigint AS n, pg_total_relation_size(?::regclass)::bigint AS bytes FROM ${table}`)
      .get(table)) as { n: string; bytes: string };
    rows += Number(row.n);
    bytes += Number(row.bytes);
  }
  const [table, column] =
    policy.unit === "days"
      ? [policy.targets[0].table, policy.targets[0].dateColumn]
      : [policy.table, policy.dateColumn];
  const oldest = (await db.prepare(`SELECT min(${column}) AS oldest FROM ${table}`).get()) as {
    oldest: string | null;
  };
  return { rows, bytes, oldest: normalizeDate(oldest.oldest) };
}

async function emailsOf(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = (await db.prepare("SELECT id, email FROM users WHERE id = ANY(?)").all(ids)) as {
    id: string;
    email: string;
  }[];
  return new Map(rows.map((row) => [row.id, row.email]));
}

async function journalView(
  policy: RetentionPolicy,
  retention: EffectiveRetention,
  lastPurge: RetentionPurgeState | null,
  emails: Map<string, string>,
): Promise<RetentionJournal> {
  return {
    key: policy.key,
    label: policy.label,
    description: policy.description,
    unit: policy.unit,
    value: retention.value,
    source: retention.source,
    defaultValue: policy.defaultValue,
    envVar: policy.envVar ?? null,
    envValue: retention.envValue,
    min: policy.min,
    max: policy.max,
    allowForever: policy.allowForever,
    confirmBelow: policy.confirmBelow ?? null,
    updatedBy:
      retention.dbValue !== null && retention.updatedBy
        ? { id: retention.updatedBy, email: emails.get(retention.updatedBy) ?? null }
        : null,
    updatedAt: retention.dbValue !== null ? retention.updatedAt : null,
    tables: policyTables(policy),
    ...(await journalVolume(policy)),
    lastPurge,
  };
}

function policyFrom(key: string): RetentionPolicy {
  const policy = findRetentionPolicy(key);
  if (!policy) throw new ApiError("RETENTION_JOURNAL_NOT_FOUND");
  return policy;
}

const keyParams = paramsOf("key");
const setBody = z.object({ value: z.number().int().nullable(), confirm: z.boolean().optional() });
const purgeBody = z.object({ confirm: z.string().optional() });

export function registerRetentionRoutes(app: FastifyInstance): void {
  app.get("/api/admin/retention", async (req) => {
    requireAdmin(req);
    const [retentions, states] = await Promise.all([allEffectiveRetentions(), readPurgeStates()]);
    const updaters = [...retentions.values()].flatMap((r) => (r.dbValue !== null && r.updatedBy ? [r.updatedBy] : []));
    const emails = await emailsOf([...new Set(updaters)]);
    const journals: RetentionJournal[] = [];
    for (const policy of RETENTION_POLICIES) {
      journals.push(await journalView(policy, retentions.get(policy.key)!, states.get(policy.key) ?? null, emails));
    }
    return { journals };
  });

  app.get("/api/admin/retention/:key/preview", async (req) => {
    requireAdmin(req);
    const policy = policyFrom(parseParams(keyParams, req).key);
    const { value } = await effectiveRetention(policy);
    const { rows, cutoff } = await previewPurge(policy, value);
    return { key: policy.key, unit: policy.unit, value, cutoff, rows };
  });

  app.put("/api/admin/retention/:key", async (req) => {
    const user = requireAdmin(req);
    const policy = policyFrom(parseParams(keyParams, req).key);
    const { value, confirm } = parseBody(setBody, req);
    if (value !== null) {
      const problem = retentionValueProblem(policy, value);
      if (problem) {
        throw new ApiError("RETENTION_VALUE_INVALID", {
          details: { reason: problem, min: policy.min, max: policy.max, allowForever: policy.allowForever },
        });
      }
      if (policy.confirmBelow !== undefined && value !== 0 && value < policy.confirmBelow && confirm !== true) {
        throw new ApiError("RETENTION_CONFIRM_REQUIRED", { details: { confirmBelow: policy.confirmBelow } });
      }
    }
    const after = await changeRetention(policy, value, user, req);
    const emails = await emailsOf(after.updatedBy ? [after.updatedBy] : []);
    const states = await readPurgeStates();
    return { journal: await journalView(policy, after, states.get(policy.key) ?? null, emails) };
  });

  app.post("/api/admin/retention/:key/purge", async (req) => {
    const user = requireAdmin(req);
    const policy = policyFrom(parseParams(keyParams, req).key);
    // The journal's own key, typed back: a purge cannot be undone.
    if (parseBody(purgeBody, req).confirm !== policy.key) {
      throw new ApiError("RETENTION_CONFIRM_REQUIRED", { details: { confirm: policy.key } });
    }
    const result = await purgeJournalNow(policy, user, req);
    if (!result) throw new ApiError("RETENTION_PURGE_RUNNING");
    return {
      key: policy.key,
      unit: policy.unit,
      value: result.value,
      deleted: result.deleted,
      cutoff: result.cutoff,
      batches: result.batches,
      at: result.at,
    };
  });
}
