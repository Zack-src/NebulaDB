import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations, MIGRATIONS } from "./migrations.js";

const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/**
 * The pre-migration shape: the tables the baseline `CREATE TABLE` block in
 * `db.ts` creates, without any of the columns the migrations add. Every table
 * a migration touches has to exist here — `ALTER TABLE` on a missing table
 * throws, which is also true in production, where `db.ts` always creates the
 * baseline before calling `runMigrations`.
 */
function freshDbMissingColumns(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL);
  `);
  return db;
}

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

test("runMigrations adds every missing column and sets user_version to the latest", () => {
  const db = freshDbMissingColumns();
  runMigrations(db);
  const projects = columnNames(db, "projects");
  assert.ok(projects.includes("status"));
  assert.ok(projects.includes("owner_id"));
  assert.ok(columnNames(db, "users").includes("disabled_at"));
  const sessions = columnNames(db, "sessions");
  assert.ok(sessions.includes("user_agent"));
  assert.ok(sessions.includes("ip"));
  assert.equal(db.pragma("user_version", { simple: true }), LATEST_VERSION);
});

test("runMigrations creates the tables introduced after the baseline", () => {
  const db = freshDbMissingColumns();
  runMigrations(db);
  assert.ok(tableExists(db, "login_attempts"), "login_attempts");
  assert.ok(tableExists(db, "audit_log"), "audit_log");
});

test("runMigrations is a no-op the second time — nothing left pending once user_version is current", () => {
  const db = freshDbMissingColumns();
  runMigrations(db);
  assert.doesNotThrow(() => runMigrations(db));
  assert.equal(db.pragma("user_version", { simple: true }), LATEST_VERSION);
});

test("a database that reached the current shape some other way (columns present, user_version stale) doesn't get double-ALTERed", () => {
  const db = freshDbMissingColumns();
  // Simulate e.g. a restore from an old backup taken before this file existed.
  db.exec("ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  db.exec("ALTER TABLE projects ADD COLUMN owner_id TEXT REFERENCES users(id)");
  db.exec("ALTER TABLE users ADD COLUMN disabled_at TEXT");
  assert.doesNotThrow(() => runMigrations(db));
  assert.equal(columnNames(db, "projects").filter((c) => c === "status").length, 1, "not double-added");
  assert.equal(columnNames(db, "users").filter((c) => c === "disabled_at").length, 1, "not double-added");
  assert.equal(db.pragma("user_version", { simple: true }), LATEST_VERSION, "still catches up to the latest version");
});

test("a fresh database whose CREATE TABLE already has every current column (the normal new-install path) still ends up at the latest user_version", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, disabled_at TEXT);
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      owner_id TEXT REFERENCES users(id)
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      user_agent TEXT,
      ip TEXT
    );
  `);
  runMigrations(db);
  assert.equal(db.pragma("user_version", { simple: true }), LATEST_VERSION);
});

test("migration versions are unique and strictly increasing", () => {
  // Guards the one mistake this list is prone to: two entries sharing a
  // version, where whichever sorts second would silently never run.
  const versions = MIGRATIONS.map((m) => m.version);
  assert.deepEqual(versions, [...new Set(versions)], "no duplicate versions");
  assert.deepEqual(versions, [...versions].sort((a, b) => a - b), "declared in ascending order");
});
