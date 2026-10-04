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
  assert.ok(tableExists(db, "table_locks"), "table_locks");
  assert.ok(tableExists(db, "instance_settings"), "instance_settings");
  assert.ok(tableExists(db, "schema_fingerprints"), "schema_fingerprints");
  assert.ok(columnNames(db, "project_connection_links").includes("out_of_schema_at"));
  assert.ok(columnNames(db, "db_connections").includes("structure_policy"));
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
  assert.deepEqual(
    versions,
    [...versions].sort((a, b) => a - b),
    "declared in ascending order",
  );
});

test("migration 18 turns per-project connections into global ones without losing ids, links or deployment history", () => {
  const db = freshDbMissingColumns();
  // Stop just before the migration under test, then seed the old shape.
  for (const migration of MIGRATIONS.filter((m) => m.version < 18)) migration.up(db);
  db.pragma("user_version = 17");
  db.exec(`
    INSERT INTO projects (id, name) VALUES ('p1', 'Shop'), ('p2', 'Blog');
    INSERT INTO project_connections (id, project_id, name, engine, environment, config_encrypted)
      VALUES ('c1', 'p1', 'Prod', 'postgres', 'production', 'blob-1'), ('c2', 'p2', 'Local', 'sqlite', NULL, 'blob-2');
    INSERT INTO deployment_history (id, project_id, connection_id, connection_name, engine, sql, success)
      VALUES ('h1', 'p1', 'c1', 'Prod', 'postgres', 'CREATE TABLE a (id int)', 1);
    INSERT INTO deployment_history (id, project_id, connection_id, connection_name, engine, sql, rollback_of, success)
      VALUES ('h2', 'p1', 'c1', 'Prod', 'postgres', 'DROP TABLE a', 'h1', 1);
  `);

  runMigrations(db);

  assert.ok(!tableExists(db, "project_connections"), "the old table is gone");
  const connections = db
    .prepare("SELECT id, name, engine, environment, config_encrypted, origin FROM db_connections ORDER BY id")
    .all();
  assert.deepEqual(connections, [
    {
      id: "c1",
      name: "Prod",
      engine: "postgres",
      environment: "production",
      config_encrypted: "blob-1",
      origin: "project",
    },
    { id: "c2", name: "Local", engine: "sqlite", environment: null, config_encrypted: "blob-2", origin: "project" },
  ]);
  assert.deepEqual(db.prepare("SELECT project_id, connection_id FROM project_connection_links ORDER BY 1").all(), [
    { project_id: "p1", connection_id: "c1" },
    { project_id: "p2", connection_id: "c2" },
  ]);
  assert.deepEqual(db.prepare("SELECT id, connection_id, rollback_of FROM deployment_history ORDER BY id").all(), [
    { id: "h1", connection_id: "c1", rollback_of: null },
    { id: "h2", connection_id: "c1", rollback_of: "h1" },
  ]);

  // History must survive its connection being deleted (the name is a snapshot), and still accept new rows.
  db.prepare("DELETE FROM db_connections WHERE id = 'c1'").run();
  assert.equal(
    (
      db.prepare("SELECT connection_id FROM deployment_history WHERE id = 'h1'").get() as {
        connection_id: string | null;
      }
    ).connection_id,
    null,
  );
  assert.doesNotThrow(() =>
    db
      .prepare(
        "INSERT INTO deployment_history (id, project_id, connection_id, connection_name, engine, sql, success) VALUES ('h3', 'p2', 'c2', 'Local', 'sqlite', 'x', 1)",
      )
      .run(),
  );
});

test("migration 23 turns each environment label into a stage, production last and flagged", () => {
  const db = freshDbMissingColumns();
  for (const migration of MIGRATIONS.filter((m) => m.version < 23)) migration.up(db);
  db.pragma("user_version = 22");
  db.exec(`
    INSERT INTO db_connections (id, name, engine, environment, config_encrypted) VALUES
      ('c1', 'Main', 'postgres', 'production', 'b'),
      ('c2', 'Pre', 'postgres', 'PreProd', 'b'),
      ('c3', 'Mine', 'sqlite', 'dev', 'b'),
      ('c4', 'Other main', 'postgres', ' Production ', 'b'),
      ('c5', 'None', 'sqlite', NULL, 'b');
  `);

  runMigrations(db);

  const stages = db
    .prepare("SELECT id, name, color, is_production AS production, position FROM environments ORDER BY position")
    .all() as { id: string; name: string; color: string; production: number; position: number }[];
  assert.deepEqual(
    stages.map((s) => [s.name, s.color, s.production]),
    [
      ["dev", "green", 0],
      ["PreProd", "amber", 0],
      ["production", "red", 1],
    ],
    "one stage per label (case and spaces ignored); 'PreProd' is not production",
  );
  const byId = new Map(stages.map((s) => [s.id, s.name]));
  const links = db.prepare("SELECT id, environment, environment_id FROM db_connections ORDER BY id").all() as {
    id: string;
    environment: string | null;
    environment_id: string | null;
  }[];
  assert.deepEqual(
    links.map((l) => [l.id, l.environment, l.environment_id ? byId.get(l.environment_id) : null]),
    [
      ["c1", "production", "production"],
      ["c2", "PreProd", "PreProd"],
      ["c3", "dev", "dev"],
      ["c4", "production", "production"],
      ["c5", null, null],
    ],
  );
});

test("migration 23 seeds DEV › Staging › Prod on an instance that had no labels", () => {
  const db = freshDbMissingColumns();
  runMigrations(db);
  assert.deepEqual(db.prepare("SELECT name, is_production AS production FROM environments ORDER BY position").all(), [
    { name: "DEV", production: 0 },
    { name: "Staging", production: 0 },
    { name: "Prod", production: 1 },
  ]);
});

test("migration 35 leaves every existing connection on its shared account and adds the personal-account table", () => {
  const db = freshDbMissingColumns();
  for (const migration of MIGRATIONS.filter((m) => m.version < 35)) migration.up(db);
  db.pragma("user_version = 34");
  db.exec(`
    INSERT INTO db_connections (id, name, engine, config_encrypted) VALUES
      ('c1', 'Main', 'postgres', 'b'),
      ('c2', 'File', 'sqlite', 'b');
  `);

  runMigrations(db);

  assert.deepEqual(db.prepare("SELECT id, auth_mode FROM db_connections ORDER BY id").all(), [
    { id: "c1", auth_mode: "shared" },
    { id: "c2", auth_mode: "shared" },
  ]);
  assert.ok(tableExists(db, "db_connection_credentials"));
  // One account per user and connection.
  const insert = db.prepare(
    "INSERT INTO db_connection_credentials (id, connection_id, user_id, username, secret_encrypted) VALUES (?, 'c1', 'u1', 'ada', 'x')",
  );
  insert.run("k1");
  assert.throws(() => insert.run("k2"), /UNIQUE/);
  // Running it again changes nothing.
  MIGRATIONS.find((m) => m.version === 35)!.up(db);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM db_connection_credentials").get() as { n: number }).n, 1);
});
