import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { useTestDatabase } from "./testDatabase.js";
import { SQLITE_V45_SCHEMA } from "./sqliteV45Schema.js";

await useTestDatabase("sqliteimport");

const { db } = await import("./db.js");
const { importSqliteFile, SqliteImportRefused } = await import("./sqliteImport.js");

const dir = mkdtempSync(join(tmpdir(), "nebuladb-sqlite-import-"));

/** A SQLite file as the last SQLite release left it, holding a little of everything that is awkward to copy. */
function legacyFile(fill: (file: Database.Database) => void = () => {}, version = 45): string {
  const path = join(dir, `${randomUUID()}.sqlite`);
  const file = new Database(path);
  file.exec(SQLITE_V45_SCHEMA);
  file.pragma(`user_version = ${version}`);
  fill(file);
  file.close();
  return path;
}

function fillTypical(file: Database.Database): void {
  file.exec(`
    INSERT INTO users (id, email, password_hash, is_admin, created_at) VALUES ('u1', 'ada@example.com', 'hash', 1, '2025-01-02 03:04:05');
    INSERT INTO projects (id, name, owner_id, created_at) VALUES ('p1', 'Shop', 'u1', '2025-01-02 03:04:06');
    INSERT INTO environments (id, name, color, protection, is_production, position) VALUES ('e1', 'Live', 'red', 'protected', 1, 0);
    INSERT INTO db_connections (id, name, engine, config_encrypted, environment_id) VALUES ('c1', 'Main', 'sqlite', 'enc', 'e1');
    INSERT INTO deployment_history (id, project_id, connection_id, connection_name, engine, sql, success) VALUES ('d1', 'p1', 'c1', 'Main', 'sqlite', 'CREATE', 1);
    INSERT INTO deployment_history (id, project_id, connection_id, connection_name, engine, sql, success, rollback_of) VALUES ('d2', 'p1', 'c1', 'Main', 'sqlite', 'DROP', 1, 'd1');
    INSERT INTO sessions (id, user_id, expires_at, ttl_ms) VALUES ('s1', 'u1', '2099-01-01T00:00:00.000Z', 2592000000);
  `);
  const revision = file.prepare("INSERT INTO revisions (id, project_id, author, yjs_update) VALUES (?, 'p1', ?, ?)");
  // Ids against insertion order: only the rowid knows which came first.
  for (const [id, author] of [
    ["r-z", "first"],
    ["r-a", "second"],
  ])
    revision.run(id, author, Buffer.from([0, 1, 2, 255]));
  file.exec(`
    INSERT INTO audit_log (id, action) VALUES ('a1', 'project.create');
    INSERT INTO audit_log (id, action) VALUES ('a2', 'project.delete');
    DELETE FROM audit_log WHERE id = 'a1';
  `);
}

test("refuses a file that is not at the last SQLite schema, and writes nothing", async () => {
  await assert.rejects(importSqliteFile(legacyFile(fillTypical, 44)), (err: unknown) => {
    assert.ok(err instanceof SqliteImportRefused);
    assert.match((err as Error).message, /version 44, not 45/);
    return true;
  });
  await assert.rejects(importSqliteFile(join(dir, "missing.sqlite")), SqliteImportRefused);
  assert.equal(await db.prepare("SELECT 1 FROM users").get(), undefined);
});

test("refuses a file with a column the new schema has no place for", async () => {
  const path = legacyFile((file) => file.exec("ALTER TABLE users ADD COLUMN shoe_size INTEGER"));
  await assert.rejects(importSqliteFile(path), /no PostgreSQL column for users\.shoe_size/);
});

test("a failure half-way leaves the target as it was", async () => {
  // A row PostgreSQL rejects (text where an integer goes), far down the copy order.
  const path = legacyFile((file) => {
    fillTypical(file);
    file.exec(
      "INSERT INTO query_stats (connection_id, query_hash, day, normalized_sql, executions, last_at) VALUES ('c', 'h', 'd', 's', 'many', 'x')",
    );
  });
  await assert.rejects(importSqliteFile(path));
  assert.equal(await db.prepare("SELECT 1 FROM users").get(), undefined);
  // The stages a new database starts with are still there.
  assert.equal(((await db.prepare("SELECT COUNT(*) AS n FROM environments").get()) as { n: number }).n, 3);
});

test("copies every table, in an order the foreign keys accept, and keeps what the app reads back", async () => {
  const copied = await importSqliteFile(legacyFile(fillTypical));
  const counts = Object.fromEntries(copied.map((table) => [table.table, table.rows]));
  assert.equal(counts.users, 1);
  assert.equal(counts.deployment_history, 2);
  assert.equal(counts.environments, 1, "the instance's own stages replace the seeded ones");

  assert.deepEqual(await db.prepare("SELECT created_at FROM users WHERE id = 'u1'").get(), {
    created_at: "2025-01-02 03:04:05",
  });
  assert.deepEqual(await db.prepare("SELECT rollback_of FROM deployment_history WHERE id = 'd2'").get(), {
    rollback_of: "d1",
  });
  assert.deepEqual(await db.prepare("SELECT ttl_ms FROM sessions WHERE id = 's1'").get(), { ttl_ms: 2592000000 });

  const revisions = (await db.prepare("SELECT author, yjs_update FROM revisions ORDER BY seq").all()) as {
    author: string;
    yjs_update: Buffer;
  }[];
  assert.deepEqual(
    revisions.map((row) => row.author),
    ["first", "second"],
  );
  assert.deepEqual([...revisions[0].yjs_update], [0, 1, 2, 255]);

  // The audit cursor is the old rowid, and the next entry comes after it.
  assert.deepEqual(await db.prepare("SELECT seq FROM audit_log WHERE id = 'a2'").get(), { seq: 2 });
  await db.prepare("INSERT INTO audit_log (id, action) VALUES ('a3', 'project.create')").run();
  assert.deepEqual(await db.prepare("SELECT seq FROM audit_log WHERE id = 'a3'").get(), { seq: 3 });
});

test("refuses a target that already holds data", async () => {
  await assert.rejects(importSqliteFile(legacyFile(fillTypical)), /not empty \(users/);
});
