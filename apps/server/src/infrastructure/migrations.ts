import type Database from "better-sqlite3";

export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

/**
 * Ordered, one-way migrations applied on top of the baseline schema (the
 * `CREATE TABLE IF NOT EXISTS` block in `db.ts`, itself idempotent and safe
 * to run unconditionally on every boot — a brand-new install gets the full
 * current shape for free and simply has nothing pending here).
 *
 * Tracked via SQLite's built-in `PRAGMA user_version` rather than a separate
 * migrations table: one integer, set atomically in the same transaction as
 * the schema change it corresponds to, with no per-row bookkeeping needed
 * for what is — and is expected to stay — a short linear list. Replaces the
 * two one-off `PRAGMA table_info` + guarded `ALTER TABLE` checks that used
 * to live directly in `db.ts`; the next schema change is a new entry here
 * instead of another hand-rolled check that's easy to forget.
 *
 * Each `up` still guards its own `ALTER` (checking the column doesn't
 * already exist) rather than trusting `user_version` alone — belt and
 * suspenders against a database that reached the current shape some other
 * way (e.g. restored from an old backup that predates this file existing).
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "projects.status column",
    up: (db) => {
      const columns = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
      if (!columns.some((c) => c.name === "status")) {
        db.exec("ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
      }
    },
  },
  {
    version: 2,
    name: "projects.owner_id column",
    up: (db) => {
      const columns = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
      if (!columns.some((c) => c.name === "owner_id")) {
        db.exec("ALTER TABLE projects ADD COLUMN owner_id TEXT REFERENCES users(id)");
      }
    },
  },
  {
    version: 3,
    name: "users.disabled_at column",
    up: (db) => {
      const columns = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
      if (!columns.some((c) => c.name === "disabled_at")) {
        db.exec("ALTER TABLE users ADD COLUMN disabled_at TEXT");
      }
    },
  },
  {
    version: 4,
    name: "sessions.user_agent and ip columns",
    up: (db) => {
      const columns = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
      if (!columns.some((c) => c.name === "user_agent")) {
        db.exec("ALTER TABLE sessions ADD COLUMN user_agent TEXT");
      }
      if (!columns.some((c) => c.name === "ip")) {
        db.exec("ALTER TABLE sessions ADD COLUMN ip TEXT");
      }
    },
  },
  {
    version: 5,
    name: "login_attempts table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS login_attempts (
          email TEXT PRIMARY KEY,
          failures INTEGER NOT NULL DEFAULT 0,
          locked_until TEXT,
          last_failure_at TEXT
        );
      `);
    },
  },
  {
    version: 6,
    name: "audit_log table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          actor_id TEXT,
          actor_email TEXT,
          action TEXT NOT NULL,
          target_type TEXT,
          target_id TEXT,
          detail TEXT,
          ip TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_type, target_id);
      `);
    },
  },
  {
    version: 7,
    name: "sessions.ttl_ms column",
    up: (db) => {
      const columns = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
      if (!columns.some((c) => c.name === "ttl_ms")) {
        db.exec("ALTER TABLE sessions ADD COLUMN ttl_ms INTEGER");
      }
    },
  },
  {
    version: 8,
    name: "project_connections table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS project_connections (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          engine TEXT NOT NULL,
          config_encrypted TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_project_connections_proj ON project_connections(project_id);
      `);
    },
  },
];

/** Applies every migration above the database's current `user_version`, each in its own transaction, in order. */
export function runMigrations(db: Database.Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  const pending = MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db);
      // Interpolated rather than bound: PRAGMA doesn't accept `?` parameters,
      // and `migration.version` is a compile-time constant from the array
      // above, never user input.
      db.pragma(`user_version = ${migration.version}`);
    })();
    console.log(`[db] applied migration ${migration.version}: ${migration.name}`);
  }
}
