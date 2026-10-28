import { config } from "../../config.js";
import { db } from "../../infrastructure/db.js";
import { RETENTION_POLICIES, retentionValueProblem, type RetentionPolicy } from "./registry.js";

/**
 * Where a journal's retention comes from. In order: what an administrator set
 * (`instance_settings`, key `retention.<key>`, value `{"value": n}`), then the
 * environment variable the journal had before the setting existed, then the
 * registry's default. A stored value that no longer fits the policy's bounds
 * (hand-edited, or bounds tightened since) is ignored rather than trusted.
 */
export type RetentionSource = "db" | "env" | "default";

export interface EffectiveRetention {
  value: number;
  source: RetentionSource;
  /** What the environment says, whatever wins. */
  envValue: number | null;
  /** The administrator's setting, when there is a valid one. */
  dbValue: number | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export const settingKey = (policyKey: string) => `retention.${policyKey}`;
const stateKey = (policyKey: string) => `retention-state.${policyKey}`;

interface SettingRow {
  key: string;
  value: string;
  updated_by: string | null;
  updated_at: string;
}

function parseStoredValue(policy: RetentionPolicy, raw: string): number | null {
  try {
    const value = (JSON.parse(raw) as { value?: unknown }).value;
    return typeof value === "number" && retentionValueProblem(policy, value) === null ? value : null;
  } catch {
    return null;
  }
}

function resolve(policy: RetentionPolicy, row: SettingRow | undefined): EffectiveRetention {
  const envValue = config.retentionEnv[policy.key] ?? null;
  const dbValue = row ? parseStoredValue(policy, row.value) : null;
  const base = { envValue, dbValue, updatedBy: row?.updated_by ?? null, updatedAt: row?.updated_at ?? null };
  if (dbValue !== null) return { value: dbValue, source: "db", ...base };
  if (envValue !== null) return { value: envValue, source: "env", ...base };
  return { value: policy.defaultValue, source: "default", ...base };
}

export async function effectiveRetention(policy: RetentionPolicy): Promise<EffectiveRetention> {
  const row = (await db
    .prepare("SELECT key, value, updated_by, updated_at FROM instance_settings WHERE key = ?")
    .get(settingKey(policy.key))) as SettingRow | undefined;
  return resolve(policy, row);
}

/** Every journal's retention in one read, keyed by policy key. */
export async function allEffectiveRetentions(): Promise<Map<string, EffectiveRetention>> {
  const rows = (await db
    .prepare("SELECT key, value, updated_by, updated_at FROM instance_settings WHERE key LIKE 'retention.%'")
    .all()) as SettingRow[];
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return new Map(RETENTION_POLICIES.map((policy) => [policy.key, resolve(policy, byKey.get(settingKey(policy.key)))]));
}

/**
 * Sets (or, with `null`, removes) the administrator's retention for a journal.
 * The caller checks the value first (`retentionValueProblem`). Returns the
 * effective retention before and after.
 */
export async function setRetention(
  policy: RetentionPolicy,
  value: number | null,
  userId: string,
): Promise<{ before: EffectiveRetention; after: EffectiveRetention }> {
  const before = await effectiveRetention(policy);
  if (value === null) {
    await db.prepare("DELETE FROM instance_settings WHERE key = ?").run(settingKey(policy.key));
  } else {
    await db
      .prepare(
        `INSERT INTO instance_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, utc_now())
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      )
      .run(settingKey(policy.key), JSON.stringify({ value }), userId);
  }
  return { before, after: await effectiveRetention(policy) };
}

/** What the last purge of a journal did, scheduled or asked for. */
export interface RetentionPurgeState {
  at: string;
  deleted: number;
  /** Rows older than this went; `null` for a journal kept by row count, or kept forever. */
  cutoff: string | null;
  trigger: "scheduled" | "manual";
}

export async function readPurgeStates(): Promise<Map<string, RetentionPurgeState>> {
  const rows = (await db
    .prepare("SELECT key, value FROM instance_settings WHERE key LIKE 'retention-state.%'")
    .all()) as { key: string; value: string }[];
  const states = new Map<string, RetentionPurgeState>();
  for (const row of rows) {
    try {
      states.set(row.key.slice("retention-state.".length), JSON.parse(row.value) as RetentionPurgeState);
    } catch {
      // A broken row only loses the "last purge" line.
    }
  }
  return states;
}

export async function writePurgeState(policyKey: string, state: RetentionPurgeState): Promise<void> {
  await db
    .prepare(
      `INSERT INTO instance_settings (key, value, updated_by, updated_at) VALUES (?, ?, NULL, utc_now())
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(stateKey(policyKey), JSON.stringify(state));
}
