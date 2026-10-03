import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The module under test reaches `infrastructure/db.ts` through `shared/errors.ts`. Without
// this, importing it would open — and migrate — the developer's real `./data` database.
process.env.ATHANORDB_DB_PATH ??= join(tmpdir(), `athanordb-test-sqlitedriver-${randomUUID()}.sqlite`);

import { diffTargetAgainstLive } from "@athanordb/dbml-engine";
import type { Project } from "@athanordb/shared";

const { SqliteDriver } = await import("./sqlite.js");
const { analyzeDeploymentRisks } = await import("../riskAnalysis.js");

test("SqliteDriver connects, introspects, measures risks, and executes migrations", async () => {
  const driver = new SqliteDriver({
    id: "test-conn",
    projectId: "p1",
    name: "Test SQLite",
    engine: "sqlite",
    database: ":memory:",
  });

  // 1. Test connection
  const connTest = await driver.testConnection();
  assert.equal(connTest.ok, true);
  assert.ok(connTest.version?.startsWith("SQLite"));

  // 2. Setup initial tables with sample data
  await driver.executeMigration(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT
    );
    INSERT INTO users (name, email) VALUES ('Alice', 'alice@test.com'), ('Bob', 'bob@test.com');
  `);

  // 3. Introspect schema
  const schema = await driver.introspectSchema();
  assert.equal(schema.tables.length, 1);
  assert.equal(schema.tables[0].name, "users");
  assert.equal(schema.tables[0].fields.length, 3);

  // 4. Test diff & risk inspection (simulate deleting 'email' column which has data)
  const targetProject: Project = {
    ...schema,
    tables: [
      {
        ...schema.tables[0],
        fields: schema.tables[0].fields.filter((f) => f.name !== "email"), // dropping email
      },
    ],
  };

  const diff = diffTargetAgainstLive(schema, targetProject);
  assert.equal(diff.hasChanges, true);

  const risks = await analyzeDeploymentRisks(driver, diff, "sqlite");
  assert.equal(risks.length, 1);
  assert.equal(risks[0].type, "DROP_COLUMN_WITH_DATA");
  assert.equal(risks[0].affectedRowCount, 2);
  assert.equal("sampleData" in risks[0], false, "a count, never the rows themselves");

  await driver.close();
});

test("SqliteDriver reads rows untruncated and inserts back what it read, bytes included", async () => {
  const config = { id: "c", projectId: "p", name: "Rows", engine: "sqlite" as const, database: ":memory:" };
  const driver = new SqliteDriver(config);
  await driver.executeMigration("CREATE TABLE blobs (id INTEGER PRIMARY KEY, big INTEGER, label TEXT, body BLOB);");
  const long = "x".repeat(20_000);
  await driver.insertRows(
    "blobs",
    ["id", "big", "label", "body"],
    [
      ["1", "9007199254740993", long, Buffer.from([0, 255, 16])],
      ["2", null, "", null],
    ],
  );
  const rows = await driver.queryRows('SELECT id, big, label, body FROM "blobs" ORDER BY id');
  assert.equal(rows.length, 2);
  // 2^53 + 1: lost as a JavaScript number, kept as a bigint.
  assert.equal(String(rows[0][1]), "9007199254740993");
  assert.equal((rows[0][2] as string).length, 20_000);
  assert.deepEqual([...(rows[0][3] as Buffer)], [0, 255, 16]);
  assert.deepEqual(rows[1].slice(1), [null, "", null]);
  await driver.close();
});
