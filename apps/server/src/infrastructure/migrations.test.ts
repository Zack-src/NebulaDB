import { test } from "node:test";
import assert from "node:assert/strict";
import { useTestDatabase } from "./testDatabase.js";

// Importing `db.js` is what migrates: by the time the import resolves, the
// fresh database this file was given is on the latest schema.
await useTestDatabase("migrations");

const { db } = await import("./db.js");
const { MIGRATIONS, runMigrations } = await import("./migrations.js");

const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

async function appliedVersions(): Promise<number[]> {
  const rows = (await db.prepare("SELECT version FROM schema_migrations ORDER BY version").all()) as {
    version: number;
  }[];
  return rows.map((row) => row.version);
}

async function tableNames(): Promise<string[]> {
  const rows = (await db
    .prepare("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()")
    .all()) as { table_name: string }[];
  return rows.map((row) => row.table_name);
}

test("migration versions are unique and strictly increasing", () => {
  const versions = MIGRATIONS.map((m) => m.version);
  assert.deepEqual(
    versions,
    [...new Set(versions)].sort((a, b) => a - b),
  );
});

test("a fresh database is brought to the latest version, and every migration is recorded", async () => {
  assert.deepEqual(
    await appliedVersions(),
    MIGRATIONS.map((m) => m.version),
  );
  assert.equal((await appliedVersions()).at(-1), LATEST_VERSION);
});

test("the baseline creates the tables the SQLite storage ended with", async () => {
  const tables = await tableNames();
  for (const name of [
    "users",
    "sessions",
    "projects",
    "revisions",
    "snapshots",
    "audit_log",
    "db_connections",
    "project_connection_links",
    "deployment_history",
    "table_seeds",
    "backups",
    "notifications",
    "db_health_samples",
  ]) {
    assert.ok(tables.includes(name), name);
  }
  // Retired by the SQLite migration 18, and never part of this schema.
  assert.ok(!tables.includes("project_connections"));
});

test("runMigrations is a no-op the second time — nothing left pending", async () => {
  const before = await tableNames();
  await runMigrations(db);
  assert.deepEqual(
    await appliedVersions(),
    MIGRATIONS.map((m) => m.version),
  );
  assert.deepEqual((await tableNames()).sort(), before.sort());
});

test("two processes migrating the same database at once take turns", async () => {
  // What a rolling restart does. Without the advisory lock both would read
  // "nothing applied yet" and the loser would fail on a table that now exists.
  await db.exec("DROP TABLE schema_migrations");
  await db.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await Promise.all([runMigrations(db), runMigrations(db), runMigrations(db)]);
  assert.deepEqual(
    await appliedVersions(),
    MIGRATIONS.map((m) => m.version),
  );
});

test("a new instance starts with the DEV › Staging › Prod chain, Prod flagged and protected", async () => {
  const stages = await db
    .prepare("SELECT name, color, protection, is_production, position FROM environments ORDER BY position")
    .all();
  assert.deepEqual(stages, [
    { name: "DEV", color: "green", protection: "free", is_production: 0, position: 0 },
    { name: "Staging", color: "amber", protection: "free", is_production: 0, position: 1 },
    { name: "Prod", color: "red", protection: "protected", is_production: 1, position: 2 },
  ]);
});

test("timestamps are written in the form the API has always returned", async () => {
  const row = (await db
    .prepare(
      `SELECT utc_now() AS now, utc_now('-2 days') AS earlier, utc_today() AS today,
              utc_shift('2026-01-31 23:30:00', '+1 day') AS shifted`,
    )
    .get()) as { now: string; earlier: string; today: string; shifted: string };
  assert.match(row.now, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(row.today, row.now.slice(0, 10));
  assert.equal(row.shifted, "2026-02-01 23:30:00");
  // UTC whatever the session's time zone: the web app parses the string as such.
  const drift = Math.abs(new Date(`${row.now.replace(" ", "T")}Z`).getTime() - Date.now());
  assert.ok(drift < 60_000, `utc_now() is ${drift} ms away from the clock`);
  const twoDays =
    new Date(`${row.now.replace(" ", "T")}Z`).getTime() - new Date(`${row.earlier.replace(" ", "T")}Z`).getTime();
  assert.equal(twoDays, 2 * 24 * 60 * 60 * 1000);

  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO projects (id, name) VALUES (?, ?)").run(id, "defaults");
  const project = (await db.prepare("SELECT created_at FROM projects WHERE id = ?").get(id)) as { created_at: string };
  assert.match(project.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("text is compared and sorted by byte, as SQLite did, whatever the database's locale", async () => {
  // Under a linguistic collation 'b' sorts before 'C', and a timestamp with a
  // `T` separator can land on the wrong side of one with a space.
  const insert = db.prepare("INSERT INTO teams (id, name) VALUES (?, ?)");
  for (const name of ["b", "C", "a", "_x"]) await insert.run(crypto.randomUUID(), name);
  const sorted = (await db
    .prepare("SELECT name FROM teams WHERE name IN ('b', 'C', 'a', '_x') ORDER BY name")
    .all()) as { name: string }[];
  assert.deepEqual(
    sorted.map((row) => row.name),
    ["C", "_x", "a", "b"],
  );
  const mixed = (await db
    .prepare("SELECT 1 AS ok FROM projects WHERE created_at < ? LIMIT 1")
    .get("9999-12-31T00:00:00.000Z")) as { ok: number } | undefined;
  assert.equal(mixed?.ok, 1);
});

test("rows that were read back in SQLite's rowid order have an explicit insertion order", async () => {
  const projectId = crypto.randomUUID();
  await db.prepare("INSERT INTO projects (id, name) VALUES (?, ?)").run(projectId, "ordered");
  const insert = db.prepare("INSERT INTO revisions (id, project_id, author, yjs_update) VALUES (?, ?, ?, ?)");
  // Ids in descending order, all within one second: only `seq` can tell them apart.
  for (const id of ["c", "b", "a"]) await insert.run(`${projectId}-${id}`, projectId, id, Buffer.from([1, 2, 3]));
  const rows = (await db
    .prepare("SELECT author, yjs_update FROM revisions WHERE project_id = ? ORDER BY seq")
    .all(projectId)) as { author: string; yjs_update: Buffer }[];
  assert.deepEqual(
    rows.map((row) => row.author),
    ["c", "b", "a"],
  );
  assert.ok(Buffer.isBuffer(rows[0].yjs_update), "binary columns come back as buffers");
  assert.deepEqual([...rows[0].yjs_update], [1, 2, 3]);
});

test("a session lifetime in milliseconds fits its column", async () => {
  const userId = crypto.randomUUID();
  await db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')").run(userId, `${userId}@x.test`);
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  await db
    .prepare("INSERT INTO sessions (id, user_id, expires_at, ttl_ms) VALUES (?, ?, utc_now('30 days'), ?)")
    .run(userId, userId, thirtyDays);
  const row = (await db.prepare("SELECT ttl_ms FROM sessions WHERE id = ?").get(userId)) as { ttl_ms: number };
  // More than a 32-bit integer holds, and a number — not the string `pg` gives a bigint by default.
  assert.strictEqual(row.ttl_ms, thirtyDays);
});

test("names declared unique without regard to case stay so", async () => {
  await assert.rejects(
    db
      .prepare("INSERT INTO environments (id, name, color, position) VALUES (?, ?, 'blue', 9)")
      .run(crypto.randomUUID(), "dev"),
    /idx_environments_name/,
  );
});
