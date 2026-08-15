import path from "node:path";
import Database from "better-sqlite3";
import type { DatabaseConnectionConfig, Project, Ref, SchemaRisk, Table, TableIndex } from "@athanordb/shared";
import type { MigrationDiff } from "@athanordb/dbml-engine";
import { config as appConfig } from "../../../config.js";
import { ApiError } from "../../../shared/errors.js";
import type { DatabaseDriver, MigrationExecutionResult, TestConnectionResult } from "./interface.js";

/**
 * Refuses to open AthanorDB's own database file as a "live" SQLite target.
 *
 * Every other engine's SSRF surface (see `hostGuard.ts`) is bounded by *who*
 * can reach this feature — but for SQLite the equivalent risk isn't a
 * network host, it's the local filesystem: a project administrator (the
 * permission level every connections route already requires) pointing this
 * at the app's own `athanordb.sqlite` would read and, via `apply-deployment`,
 * write arbitrary SQL against the table holding every password hash, session
 * token and audit entry the app has. That's a strictly worse outcome than
 * anything a misconfigured *live* database connection could cause, so it's
 * worth a dedicated guard rather than leaving it to the admin-only bar alone.
 *
 * Deliberately narrow, not a full path allowlist: nothing here stops opening
 * some *other* file on the server's filesystem the process can write to —
 * that's a real, still-open residual risk (tracked in `docs/todo.md`), not
 * one this function claims to close.
 */
function assertNotAppDatabase(requestedPath: string): void {
  if (requestedPath === ":memory:") return;
  const resolvedRequested = path.resolve(requestedPath);
  const resolvedApp = path.resolve(appConfig.dbPath);
  if (resolvedRequested === resolvedApp) {
    throw new ApiError("CONNECTION_TARGET_FORBIDDEN", {
      message: "refusing to open AthanorDB's own database file as a live connection target",
    });
  }
}

export class SqliteDriver implements DatabaseDriver {
  private db: Database.Database;

  constructor(config: DatabaseConnectionConfig) {
    const requestedPath = config.filePath || config.database || ":memory:";
    assertNotAppDatabase(requestedPath);
    this.db = new Database(requestedPath);
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      const row = this.db.prepare("SELECT sqlite_version() AS version").get() as { version: string };
      return {
        ok: true,
        version: `SQLite ${row?.version}`,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async introspectSchema(): Promise<Project> {
    const tablesRows = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];

    const tables: Table[] = [];
    const refs: Ref[] = [];

    for (let idx = 0; idx < tablesRows.length; idx++) {
      const tableName = tablesRows[idx].name;
      const colInfo = this.db.prepare(`PRAGMA table_info("${tableName}")`).all() as {
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }[];

      const fields = colInfo.map((c) => ({
        id: `${tableName}.${c.name}`,
        name: c.name,
        type: c.type || "text",
        pk: c.pk > 0,
        notNull: c.notnull === 1,
        default: c.dflt_value !== null ? String(c.dflt_value) : undefined,
      }));

      // Foreign keys
      const fkInfo = this.db.prepare(`PRAGMA foreign_key_list("${tableName}")`).all() as {
        id: number;
        seq: number;
        table: string;
        from: string;
        to: string;
      }[];

      for (const fk of fkInfo) {
        refs.push({
          id: `fk-${tableName}-${fk.id}-${fk.from}`,
          from: {
            tableId: tableName,
            fieldId: `${tableName}.${fk.from}`,
          },
          to: {
            tableId: fk.table,
            fieldId: `${fk.table}.${fk.to}`,
          },
          cardinality: "one-to-many" as const,
        });
      }

      tables.push({
        id: tableName,
        name: tableName,
        fields,
        indexes: [] as TableIndex[],
        position: { x: (idx % 6) * 320, y: Math.floor(idx / 6) * 400 },
        detailLevel: "standard" as const,
      });
    }

    return {
      id: "live-sqlite-project",
      name: "SQLite Live",
      tables,
      refs,
      enums: [],
      zones: [],
      stickyNotes: [],
      tableGroups: [],
    };
  }

  async inspectRisks(diff: MigrationDiff): Promise<SchemaRisk[]> {
    const risks: SchemaRisk[] = [];

    // Dropped tables
    for (const t of diff.tables.filter((t) => t.status === "dropped")) {
      try {
        const row = this.db.prepare(`SELECT COUNT(*) AS c FROM "${t.name}"`).get() as { c: number };
        const count = row?.c ?? 0;
        if (count > 0) {
          const sampleRows = this.db.prepare(`SELECT * FROM "${t.name}" LIMIT 5`).all() as Record<string, unknown>[];
          risks.push({
            id: `risk-table-drop-${t.name}`,
            type: "DROP_TABLE_WITH_DATA",
            severity: "critical",
            tableName: t.name,
            affectedRowCount: count,
            sampleData: sampleRows,
            availableStrategies: [
              {
                key: "DROP_DATA_CONFIRMED",
                labelKey: "connections.strategy.dropData",
                descriptionKey: "connections.strategy.dropDataDesc",
              },
              {
                key: "KEEP_IN_DB",
                labelKey: "connections.strategy.keepInDb",
                descriptionKey: "connections.strategy.keepInDbDesc",
              },
              {
                key: "CANCEL",
                labelKey: "connections.strategy.cancel",
                descriptionKey: "connections.strategy.cancelDesc",
              },
            ],
            defaultStrategy: "KEEP_IN_DB",
            selectedStrategy: "KEEP_IN_DB",
          });
        }
      } catch {
        // ignore
      }
    }

    // Modified tables
    for (const t of diff.tables.filter((t) => t.status === "modified")) {
      // Dropped columns
      for (const f of t.fields.filter((f) => f.status === "dropped")) {
        try {
          const row = this.db.prepare(`SELECT COUNT(*) AS c FROM "${t.name}" WHERE "${f.name}" IS NOT NULL`).get() as {
            c: number;
          };
          const count = row?.c ?? 0;
          if (count > 0) {
            const sampleRows = this.db
              .prepare(`SELECT "${f.name}" AS val FROM "${t.name}" WHERE "${f.name}" IS NOT NULL LIMIT 5`)
              .all() as { val: unknown }[];
            risks.push({
              id: `risk-col-drop-${t.name}-${f.name}`,
              type: "DROP_COLUMN_WITH_DATA",
              severity: "critical",
              tableName: t.name,
              columnName: f.name,
              affectedRowCount: count,
              sampleData: sampleRows.map((r) => r.val) as (
                string | number | boolean | Record<string, unknown> | null
              )[],
              availableStrategies: [
                {
                  key: "DROP_DATA_CONFIRMED",
                  labelKey: "connections.strategy.dropData",
                  descriptionKey: "connections.strategy.dropDataDesc",
                },
                {
                  key: "KEEP_IN_DB",
                  labelKey: "connections.strategy.keepColumn",
                  descriptionKey: "connections.strategy.keepColumnDesc",
                },
                {
                  key: "CANCEL",
                  labelKey: "connections.strategy.cancel",
                  descriptionKey: "connections.strategy.cancelDesc",
                },
              ],
              defaultStrategy: "KEEP_IN_DB",
              selectedStrategy: "KEEP_IN_DB",
            });
          }
        } catch {
          // ignore
        }
      }

      // Altered type
      for (const f of t.fields.filter((f) => f.status === "modified" && f.typeChanged)) {
        try {
          const row = this.db.prepare(`SELECT COUNT(*) AS c FROM "${t.name}" WHERE "${f.name}" IS NOT NULL`).get() as {
            c: number;
          };
          const count = row?.c ?? 0;
          if (count > 0) {
            const sampleRows = this.db
              .prepare(`SELECT "${f.name}" AS val FROM "${t.name}" WHERE "${f.name}" IS NOT NULL LIMIT 5`)
              .all() as { val: unknown }[];
            risks.push({
              id: `risk-col-type-${t.name}-${f.name}`,
              type: "ALTER_COLUMN_TYPE",
              severity: "warning",
              tableName: t.name,
              columnName: f.name,
              affectedRowCount: count,
              sampleData: sampleRows.map((r) => r.val) as (
                string | number | boolean | Record<string, unknown> | null
              )[],
              availableStrategies: [
                {
                  key: "FORCE_CAST",
                  labelKey: "connections.strategy.forceCast",
                  descriptionKey: "connections.strategy.forceCastDesc",
                },
                {
                  key: "CLEAR_COLUMN_DATA",
                  labelKey: "connections.strategy.clearData",
                  descriptionKey: "connections.strategy.clearDataDesc",
                },
                {
                  key: "CANCEL",
                  labelKey: "connections.strategy.cancel",
                  descriptionKey: "connections.strategy.cancelDesc",
                },
              ],
              defaultStrategy: "FORCE_CAST",
              selectedStrategy: "FORCE_CAST",
            });
          }
        } catch {
          // ignore
        }
      }
    }

    return risks;
  }

  async executeMigration(sql: string): Promise<MigrationExecutionResult> {
    try {
      // The generated SQL already embeds its own BEGIN/COMMIT (see
      // `migrationGenerator.ts`); SQLite DDL is transactional, so a failure
      // partway through leaves an open transaction on this connection rather
      // than an auto-rollback. `db.exec` throwing doesn't clean that up by
      // itself — an explicit ROLLBACK in the catch below does.
      this.db.exec(sql);
      return {
        success: true,
        executedStatements: sql.split(";").filter((s) => s.trim().length > 0).length,
      };
    } catch (err) {
      try {
        this.db.exec("ROLLBACK;");
      } catch {
        // Nothing to roll back (the failure happened before BEGIN ever ran) — fine.
      }
      return {
        success: false,
        executedStatements: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
