import type { DatabaseEngine } from "./engine.js";

/**
 * What the admin console knows about the built-in roles of each engine, so a
 * name like `dbcreator` or `pg_write_all_data` can be shown with a plain
 * sentence and a warning level instead of bare jargon.
 *
 * Only the risk lives here; the sentence is a translation entry named
 * `dbadmin.role.<engine>.<role lower-cased>`, so adding a role is one line here
 * plus one line in each locale file.
 */
export type DbRoleRisk = "low" | "medium" | "high";

const CATALOG: Partial<Record<DatabaseEngine, Record<string, DbRoleRisk>>> = {
  mssql: {
    // Server roles
    sysadmin: "high",
    serveradmin: "high",
    securityadmin: "high",
    setupadmin: "medium",
    processadmin: "medium",
    diskadmin: "medium",
    dbcreator: "medium",
    bulkadmin: "medium",
    // Database roles
    db_owner: "high",
    db_securityadmin: "high",
    db_accessadmin: "medium",
    db_backupoperator: "medium",
    db_ddladmin: "medium",
    db_datawriter: "medium",
    db_datareader: "low",
    db_denydatawriter: "low",
    db_denydatareader: "low",
  },
  postgres: {
    pg_read_all_data: "low",
    pg_write_all_data: "medium",
    pg_read_all_settings: "low",
    pg_read_all_stats: "low",
    pg_stat_scan_tables: "low",
    pg_monitor: "low",
    pg_signal_backend: "medium",
    pg_database_owner: "medium",
    pg_checkpoint: "medium",
    pg_maintain: "medium",
    pg_create_subscription: "medium",
    pg_use_reserved_connections: "low",
    pg_read_server_files: "high",
    pg_write_server_files: "high",
    pg_execute_server_program: "high",
  },
  oracle: {
    connect: "low",
    resource: "medium",
    dba: "high",
    select_catalog_role: "low",
    scheduler_admin: "medium",
    exp_full_database: "high",
    imp_full_database: "high",
    datapump_exp_full_database: "high",
    datapump_imp_full_database: "high",
  },
};

export interface DbRoleInfo {
  risk: DbRoleRisk;
  /** Translation key of the one-line explanation. */
  descriptionKey: string;
}

/** The documented built-in role of that name, or `undefined` for a custom one (or one not catalogued). */
export function dbRoleInfo(engine: DatabaseEngine, role: string): DbRoleInfo | undefined {
  const key = role.toLowerCase();
  const risk = CATALOG[engine]?.[key];
  return risk ? { risk, descriptionKey: `dbadmin.role.${engine}.${key}` } : undefined;
}

/** Every catalogued role name of an engine, lower-cased — what locale files must cover. */
export function dbRoleNames(engine: DatabaseEngine): string[] {
  return Object.keys(CATALOG[engine] ?? {});
}

export type DbRoleLevel = "none" | "read" | "write" | "admin";

/**
 * "Access level" shortcuts: a level is a set of roles the engine ships. Absent
 * where an engine has no such roles (MySQL: privileges are granted directly) or
 * where the level would be meaningless (a SQL Server login has no data access
 * of its own — it lives at database level).
 */
export type DbAccessPresets = Partial<Record<Exclude<DbRoleLevel, "none">, string[]>>;

export function dbAccessPresets(engine: DatabaseEngine, databaseLevel: boolean): DbAccessPresets | null {
  if (engine === "mssql" && databaseLevel) {
    return { read: ["db_datareader"], write: ["db_datareader", "db_datawriter"], admin: ["db_owner"] };
  }
  if (engine === "postgres") {
    return { read: ["pg_read_all_data"], write: ["pg_read_all_data", "pg_write_all_data"] };
  }
  return null;
}
