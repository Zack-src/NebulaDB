import test from "node:test";
import assert from "node:assert/strict";
import { PostgresDriver } from "./postgres.js";
import { TEST_DB_HINT } from "./testDbAvailability.js";
import { diffTargetAgainstLive, generateMigrationSql } from "@athanordb/dbml-engine";
import type { Project } from "@athanordb/shared";

// Matches docker-compose.test.yml's `athanordb-test-postgres` service.
// Override via env if you're pointing this at a differently-configured
// throwaway instance.
const config = {
  id: "test-conn",
  projectId: "p1",
  name: "Test Postgres",
  engine: "postgres" as const,
  host: process.env.ATHANORDB_TEST_PG_HOST || "localhost",
  port: Number(process.env.ATHANORDB_TEST_PG_PORT || 55432),
  database: process.env.ATHANORDB_TEST_PG_DATABASE || "athanordb_test",
  user: process.env.ATHANORDB_TEST_PG_USER || "athanordb_test",
  password: process.env.ATHANORDB_TEST_PG_PASSWORD || "athanordb_test",
};

test("PostgresDriver connects, introspects, inspects risks with sample data, deploys migrations", async (t) => {
  const driver = new PostgresDriver(config);

  // testConnection() swallows connection failures into `.error` rather than
  // throwing, so "nothing's listening" is detected from that instead of a
  // thrown error's `.code`.
  const connTest = await driver.testConnection();
  if (!connTest.ok) {
    await driver.close().catch(() => {});
    t.skip(
      `no Postgres test container reachable at ${config.host}:${config.port} (${TEST_DB_HINT}): ${connTest.error}`,
    );
    return;
  }

  try {
    // 1. Connection metadata
    assert.equal(connTest.ok, true);
    assert.ok(connTest.version?.toLowerCase().includes("postgresql"));
    assert.equal(connTest.database, config.database);

    // 2. Start from a clean slate — a re-run against a persistent instance
    // shouldn't trip over the previous run's tables.
    await driver.executeMigration(`DROP TABLE IF EXISTS users CASCADE;`);

    // 3. Deploy an initial schema + seed data, exactly the path
    // apply-deployment drives (BEGIN ... COMMIT wrapped generated SQL).
    const initial = await driver.executeMigration(`
      BEGIN;
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT
      );
      INSERT INTO users (name, email) VALUES ('Alice', 'alice@test.com'), ('Bob', 'bob@test.com');
      COMMIT;
    `);
    assert.equal(initial.success, true);

    // 4. Introspect it back
    const schema = await driver.introspectSchema();
    const users = schema.tables.find((tbl) => tbl.name === "users");
    assert.ok(users, "introspection should find the users table");
    assert.equal(users!.fields.length, 3);
    assert.ok(users!.fields.find((f) => f.name === "id" && f.pk));

    // 5. Diff the live DB against a target project that drops the `email`
    // column, and confirm the risk engine flags the data loss with samples —
    // the exact plan-deployment path the app takes before letting a human
    // pick a resolution strategy.
    const targetProject: Project = {
      ...schema,
      tables: [
        {
          ...users!,
          fields: users!.fields.filter((f) => f.name !== "email"),
        },
      ],
    };
    const diff = diffTargetAgainstLive(schema, targetProject);
    assert.equal(diff.hasChanges, true);

    const risks = await driver.inspectRisks(diff);
    const dropRisk = risks.find((r) => r.type === "DROP_COLUMN_WITH_DATA");
    assert.ok(dropRisk, "dropping a populated column should be flagged as a risk");
    assert.equal(dropRisk!.affectedRowCount, 2);
    assert.deepEqual([...(dropRisk!.sampleData ?? [])].sort(), ["alice@test.com", "bob@test.com"]);

    // 6. Generate the real migration SQL for that diff and actually apply it
    // end-to-end (apply-deployment's exact call sequence), then confirm the
    // live schema reflects it.
    const sql = generateMigrationSql(diff, "postgres", {
      [dropRisk!.id]: { strategy: "DROP_DATA_CONFIRMED" },
    });
    const applied = await driver.executeMigration(sql);
    assert.equal(applied.success, true, applied.error ?? "migration should have succeeded");
    assert.ok(applied.executedStatements > 0);

    const afterSchema = await driver.introspectSchema();
    const usersAfter = afterSchema.tables.find((tbl) => tbl.name === "users");
    assert.ok(usersAfter);
    assert.ok(!usersAfter!.fields.find((f) => f.name === "email"), "email column should be gone after deployment");

    // 7. A migration with a deliberately invalid statement should fail
    // cleanly and leave the connection usable afterwards (executeMigration's
    // own ROLLBACK-on-error path).
    const broken = await driver.executeMigration(
      `BEGIN; ALTER TABLE users ADD COLUMN "bogus" NOPE_NOT_A_TYPE; COMMIT;`,
    );
    assert.equal(broken.success, false);
    assert.ok(broken.error);

    const stillWorks = await driver.testConnection();
    assert.equal(stillWorks.ok, true);
  } finally {
    await driver.executeMigration(`DROP TABLE IF EXISTS users CASCADE;`).catch(() => {});
    await driver.close();
  }
});
