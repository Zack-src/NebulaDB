/**
 * Every journal NebulaDB keeps, and how long it keeps it: one declaration per
 * journal, read by the scheduled purge, the admin API and the documentation.
 *
 * A journal is kept either for a number of days (`unit: "days"`, rows older
 * than the cutoff go) or as the latest N rows (`unit: "rows"`, optionally per
 * group: per user, per connection…). The defaults are what each journal did
 * before this registry existed, so nothing changes until an administrator
 * changes it.
 *
 * Not journals, and so not here: sessions, MFA challenges, password reset
 * tokens and login attempt counters expire by their own rule (they are state,
 * not history), and backups have their own per-schedule retention.
 *
 * SQL fragments below are fixed strings written here, never built from input.
 * In them the purged table is aliased `t`.
 */

/** How a target's date column is written. */
export type RetentionDateFormat =
  /** `YYYY-MM-DD HH:MM:SS` UTC, as `utc_now()` writes it. */
  | "timestamp"
  /** `YYYY-MM-DD`, as `utc_today()` writes it. */
  | "day"
  /** `toISOString()`: `YYYY-MM-DDTHH:MM:SS.sssZ`. */
  | "iso";

/** One table a days-based journal purges. */
export interface RetentionTarget {
  table: string;
  dateColumn: string;
  dateFormat: RetentionDateFormat;
  /** What a row past the cutoff must also be to go (rows that must survive whatever their age). */
  purgeableWhere?: string;
  /** Rows that belong to nothing any more: removed on every pass, even when the journal is kept forever. */
  orphanWhere?: string;
}

interface RetentionPolicyBase {
  /** Stable identifier: the API path segment and the `instance_settings` key (`retention.<key>`). */
  key: string;
  /** Short French label for the admin console. */
  label: string;
  /** One French sentence: what the journal holds and what the purge spares. */
  description: string;
  /** What the journal does without any setting: the behaviour it had before the registry. */
  defaultValue: number;
  /** Bounds an administrator may set (inclusive), `0` aside. */
  min: number;
  max: number;
  /** Whether `0` (keep forever) is accepted. Refused where a journal would grow without bound for no benefit. */
  allowForever: boolean;
  /** The environment variable that already set this journal's retention, still honoured below an admin setting. */
  envVar?: string;
  /** A value below this needs an explicit confirmation (the audit trail). */
  confirmBelow?: number;
  /** Plain statements run on every pass, before the purge (orphan rows of side tables). */
  cleanup?: string[];
}

export interface DaysRetentionPolicy extends RetentionPolicyBase {
  unit: "days";
  /** The first target is the journal itself: its row count and oldest date are the ones shown. */
  targets: RetentionTarget[];
}

export interface RowsRetentionPolicy extends RetentionPolicyBase {
  unit: "rows";
  table: string;
  /** Shown as the oldest entry. */
  dateColumn: string;
  /** The latest N are kept per group of these columns; none: across the whole table. */
  partitionBy: string[];
  /** Newest first. */
  orderBy: string;
}

export type RetentionPolicy = DaysRetentionPolicy | RowsRetentionPolicy;

/** Deployments always kept per project and database, whatever their age: the pipeline and rollbacks read them. */
export const DEPLOYMENTS_ALWAYS_KEPT = 20;

const ORPHAN_CONNECTION = "t.connection_id NOT IN (SELECT id FROM db_connections)";

export const RETENTION_POLICIES: readonly RetentionPolicy[] = [
  {
    key: "audit_log",
    label: "Journal d'audit",
    description: "Qui a fait quoi sur l'instance. Descendre sous 90 jours demande une confirmation.",
    unit: "days",
    defaultValue: 365,
    min: 7,
    max: 3650,
    allowForever: true,
    envVar: "NEBULADB_AUDIT_RETENTION_DAYS",
    confirmBelow: 90,
    targets: [{ table: "audit_log", dateColumn: "created_at", dateFormat: "timestamp" }],
  },
  {
    key: "error_log",
    label: "Erreurs serveur et client",
    description: "Les erreurs inattendues, pour le diagnostic. Les plus récentes sont gardées.",
    unit: "rows",
    defaultValue: 2000,
    min: 100,
    max: 100_000,
    allowForever: false,
    table: "error_log",
    dateColumn: "created_at",
    partitionBy: [],
    orderBy: "created_at DESC, seq DESC",
  },
  {
    key: "webhook_deliveries",
    label: "Livraisons de webhooks",
    description: "Chaque envoi de webhook et sa réponse. Les livraisons encore en attente ne sont jamais purgées.",
    unit: "days",
    defaultValue: 30,
    min: 1,
    max: 3650,
    allowForever: true,
    targets: [
      {
        table: "webhook_deliveries",
        dateColumn: "created_at",
        dateFormat: "iso",
        purgeableWhere: "t.status <> 'pending'",
      },
    ],
  },
  {
    key: "db_health_samples",
    label: "Santé des connexions",
    description: "Les mesures de disponibilité et de latence de chaque connexion (onglet Santé).",
    unit: "days",
    defaultValue: 7,
    min: 1,
    max: 365,
    allowForever: false,
    targets: [
      { table: "db_health_samples", dateColumn: "at", dateFormat: "timestamp", orphanWhere: ORPHAN_CONNECTION },
    ],
  },
  {
    key: "query_stats",
    label: "Statistiques de la console SQL",
    description: "Exécutions et durées par requête et par jour (vue Requêtes du journal d'une connexion).",
    unit: "days",
    defaultValue: 30,
    min: 1,
    max: 3650,
    allowForever: true,
    envVar: "NEBULADB_QUERY_STATS_RETENTION_DAYS",
    targets: [{ table: "query_stats", dateColumn: "day", dateFormat: "day", orphanWhere: ORPHAN_CONNECTION }],
  },
  {
    key: "db_activity",
    label: "Activité des bases",
    description: "Sessions observées côté serveur et compteurs de trafic des connexions surveillées.",
    unit: "days",
    defaultValue: 14,
    min: 1,
    max: 3650,
    allowForever: true,
    envVar: "NEBULADB_DB_ACTIVITY_RETENTION_DAYS",
    cleanup: ["DELETE FROM db_activity_watch WHERE connection_id NOT IN (SELECT id FROM db_connections)"],
    targets: [
      { table: "db_activity", dateColumn: "day", dateFormat: "day", orphanWhere: ORPHAN_CONNECTION },
      { table: "db_counter_samples", dateColumn: "taken_at", dateFormat: "timestamp", orphanWhere: ORPHAN_CONNECTION },
    ],
  },
  {
    key: "admin_query_history",
    label: "Historique de la console SQL",
    description: "Les dernières requêtes de chaque administrateur, par connexion.",
    unit: "rows",
    defaultValue: 200,
    min: 10,
    max: 5000,
    allowForever: false,
    table: "admin_query_history",
    dateColumn: "created_at",
    partitionBy: ["connection_id", "user_id"],
    orderBy: "created_at DESC, seq DESC",
  },
  {
    key: "notifications",
    label: "Notifications",
    description: "Les dernières notifications de chaque utilisateur.",
    unit: "rows",
    defaultValue: 200,
    min: 10,
    max: 5000,
    allowForever: false,
    table: "notifications",
    dateColumn: "created_at",
    partitionBy: ["user_id"],
    orderBy: "seq DESC",
  },
  {
    key: "drift_events",
    label: "Événements de dérive",
    description: "Les écarts constatés par la surveillance. Ceux encore ouverts ne sont jamais purgés.",
    unit: "days",
    defaultValue: 0,
    min: 7,
    max: 3650,
    allowForever: true,
    targets: [
      { table: "drift_events", dateColumn: "detected_at", dateFormat: "timestamp", purgeableWhere: "t.status <> 'open'" },
    ],
  },
  {
    key: "deployment_history",
    label: "Historique des déploiements",
    description:
      `Les déploiements et retours arrière. Les ${DEPLOYMENTS_ALWAYS_KEPT} derniers par projet et par base, ` +
      "et ceux qu'un retour arrière désigne, sont toujours gardés.",
    unit: "days",
    defaultValue: 0,
    min: 30,
    max: 3650,
    allowForever: true,
    targets: [
      {
        table: "deployment_history",
        dateColumn: "created_at",
        dateFormat: "timestamp",
        purgeableWhere:
          "NOT EXISTS (SELECT 1 FROM deployment_history r WHERE r.rollback_of = t.id)" +
          " AND (SELECT count(*) FROM deployment_history n WHERE n.project_id = t.project_id" +
          ` AND n.connection_id IS NOT DISTINCT FROM t.connection_id AND n.seq > t.seq) >= ${DEPLOYMENTS_ALWAYS_KEPT}`,
      },
    ],
  },
];

export function findRetentionPolicy(key: string): RetentionPolicy | undefined {
  return RETENTION_POLICIES.find((policy) => policy.key === key);
}

/** Every table a policy touches; the first is the journal itself. */
export function policyTables(policy: RetentionPolicy): string[] {
  return policy.unit === "days" ? policy.targets.map((target) => target.table) : [policy.table];
}

/** Why `value` cannot be set on `policy`, or `null` when it can. */
export function retentionValueProblem(policy: RetentionPolicy, value: number): string | null {
  if (!Number.isInteger(value)) return "must be an integer";
  if (value === 0) return policy.allowForever ? null : "this journal cannot be kept forever";
  if (value < policy.min || value > policy.max) return `must be between ${policy.min} and ${policy.max}`;
  return null;
}
