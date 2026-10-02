import Database from "better-sqlite3";
import type {
  DbAdminCapabilities,
  DbAdminDatabase,
  DbAdminObjectRef,
  DbAdminQueryResult,
  DbAdminSchema,
  DbAdminSession,
  DbAdminTable,
  DbAdminTableDescription,
  DbGrant,
  DbPrincipal,
  DbPrivilegeCatalog,
} from "@athanordb/shared";
import type { DriverConnectionConfig } from "../../connections/drivers/interface.js";
import { assertSqlitePathAllowed } from "../../connections/drivers/sqlite.js";
import { assertReadOnlyStatement } from "../sqlGuard.js";
import { plain, quoteDouble as q, requireName, toResult, trimStatement, unsupported } from "./common.js";
import type { AdminStatement, DatabaseAdminDriver, DropKind, RunQueryOptions } from "./interface.js";

/**
 * SQLite: one file, no accounts, no sessions. Read-only work goes through a
 * handle opened read-only, so the file itself refuses a write whatever the
 * statement says. Calls are synchronous and block the event loop for their
 * duration — there is no statement timeout to set on this engine.
 */
export class SqliteAdminDriver implements DatabaseAdminDriver {
  readonly capabilities: DbAdminCapabilities = {
    multiDatabase: false,
    schemas: false,
    users: false,
    sessions: false,
    dropDatabase: false,
    principalLevels: false,
    principalHost: false,
  };

  private path: string;
  private handles = new Map<boolean, Database.Database>();

  constructor(config: DriverConnectionConfig) {
    this.path = config.filePath || config.database || ":memory:";
    assertSqlitePathAllowed(this.path);
  }

  private handle(readonly: boolean): Database.Database {
    // An in-memory database can't be opened read-only (there is nothing to open), and is empty anyway.
    const mode = readonly && this.path !== ":memory:";
    let db = this.handles.get(mode);
    if (!db) {
      db = new Database(this.path, mode ? { readonly: true, fileMustExist: true } : {});
      this.handles.set(mode, db);
    }
    return db;
  }

  async listDatabases(): Promise<DbAdminDatabase[]> {
    return [{ name: "main", system: false, sizeBytes: null }];
  }

  async listSchemas(): Promise<DbAdminSchema[]> {
    return [];
  }

  async listTables(): Promise<DbAdminTable[]> {
    const rows = this.handle(true)
      .prepare(
        "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string; type: string }[];
    return rows.map((r) => ({
      schema: null,
      name: r.name,
      kind: r.type === "view" ? "view" : "table",
      rowEstimate: null,
      sizeBytes: null,
    }));
  }

  async describeTable(ref: DbAdminObjectRef): Promise<DbAdminTableDescription> {
    const db = this.handle(true);
    const table = q(requireName(ref.table, "table"));
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }[];
    const indexList = db.prepare(`PRAGMA index_list(${table})`).all() as {
      name: string;
      unique: number;
      origin: string;
    }[];
    const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as {
      id: number;
      table: string;
      from: string;
      to: string | null;
    }[];
    return {
      columns: columns.map((c) => ({
        name: c.name,
        type: c.type,
        nullable: c.notnull === 0,
        defaultValue: c.dflt_value,
        primaryKey: c.pk > 0,
      })),
      indexes: indexList.map((i) => ({
        name: i.name,
        columns: (db.prepare(`PRAGMA index_info(${q(i.name)})`).all() as { name: string | null }[]).map(
          (c) => c.name ?? "(expression)",
        ),
        unique: i.unique === 1,
        primary: i.origin === "pk",
      })),
      constraints: foreignKeys.map((fk) => ({
        name: `fk_${fk.id}`,
        type: "FOREIGN KEY",
        definition: `(${fk.from}) → ${fk.table}(${fk.to ?? "rowid"})`,
      })),
    };
  }

  private read(db: Database.Database, sql: string, maxRows: number, startedAt: number): DbAdminQueryResult {
    const statement = db.prepare(sql);
    if (!statement.reader) {
      const info = statement.run();
      return toResult([], [], maxRows, startedAt, info.changes);
    }
    const columns = statement.columns().map((c) => c.name);
    const rows: unknown[][] = [];
    for (const row of statement.raw().iterate() as IterableIterator<unknown[]>) {
      rows.push(row);
      if (rows.length > maxRows) break;
    }
    return toResult(columns, rows, maxRows, startedAt);
  }

  async browseRows(ref: DbAdminObjectRef, page: { limit: number; offset: number }): Promise<DbAdminQueryResult> {
    const sql = `SELECT * FROM ${q(requireName(ref.table, "table"))} LIMIT ${page.limit + 1} OFFSET ${page.offset}`;
    return this.read(this.handle(true), sql, page.limit, Date.now());
  }

  async runQuery(sql: string, options: RunQueryOptions): Promise<DbAdminQueryResult> {
    const statement = trimStatement(sql);
    if (options.readOnly) assertReadOnlyStatement(statement, "sqlite");
    return this.read(this.handle(options.readOnly), statement, options.maxRows, Date.now());
  }

  dropStatements(kind: DropKind, ref: DbAdminObjectRef): AdminStatement[] {
    if (kind === "database") throw unsupported("dropping a database");
    const table = q(requireName(ref.table, "table"));
    if (kind === "column") return [plain(`ALTER TABLE ${table} DROP COLUMN ${q(requireName(ref.column, "column"))}`)];
    return [plain(`DROP ${kind === "view" ? "VIEW" : "TABLE"} ${table}`)];
  }

  privilegeCatalog(): DbPrivilegeCatalog {
    return {};
  }

  async listPrincipals(): Promise<DbPrincipal[]> {
    throw unsupported("user management");
  }

  async listGrants(): Promise<DbGrant[]> {
    throw unsupported("user management");
  }

  userStatements(): AdminStatement[] {
    throw unsupported("user management");
  }

  async listSessions(): Promise<DbAdminSession[]> {
    throw unsupported("session monitoring");
  }

  killSessionStatements(): AdminStatement[] {
    throw unsupported("session monitoring");
  }

  async execute(statements: AdminStatement[]): Promise<void> {
    const db = this.handle(false);
    db.transaction(() => {
      for (const statement of statements) db.exec(statement.sql);
    })();
  }

  async close(): Promise<void> {
    for (const db of this.handles.values()) db.close();
    this.handles.clear();
  }
}
