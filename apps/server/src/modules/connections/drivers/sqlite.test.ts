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

test("SqliteDriver connects, introspects, inspects risks with sample data, and executes migrations", async () => {
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

  const risks = await driver.inspectRisks(diff);
  assert.equal(risks.length, 1);
  assert.equal(risks[0].type, "DROP_COLUMN_WITH_DATA");
  assert.equal(risks[0].affectedRowCount, 2);
  assert.deepEqual(risks[0].sampleData, ["alice@test.com", "bob@test.com"]);

  await driver.close();
});
