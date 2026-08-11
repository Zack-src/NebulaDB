import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.js";
import { runMigrations } from "./migrations.js";

const DB_PATH = config.dbPath;

try {
  mkdirSync(dirname(DB_PATH), { recursive: true });
} catch (err) {
  console.error(`[db] cannot create the directory for ATHANORDB_DB_PATH (${DB_PATH}):`, err);
  process.exit(1);
}

export const db: Database.Database = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS revisions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    author TEXT NOT NULL,
    label TEXT,
    yjs_update BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS snapshots (
    project_id TEXT PRIMARY KEY REFERENCES projects(id),
    yjs_state BLOB NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    display_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS invitations (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    invited_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    accepted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);

  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS team_members (
    team_id TEXT NOT NULL REFERENCES teams(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (team_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

  CREATE TABLE IF NOT EXISTS project_teams (
    project_id TEXT NOT NULL REFERENCES projects(id),
    team_id TEXT NOT NULL REFERENCES teams(id),
    permission TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (project_id, team_id)
  );
  CREATE INDEX IF NOT EXISTS idx_project_teams_team ON project_teams(team_id);
`);

// `CREATE TABLE IF NOT EXISTS` above only creates new columns on a brand-new
// database — a pre-existing database needs each schema change applied
// explicitly. See migrations.ts for the versioned runner this replaced two
// one-off `PRAGMA table_info` + guarded `ALTER TABLE` checks with.
runMigrations(db);
