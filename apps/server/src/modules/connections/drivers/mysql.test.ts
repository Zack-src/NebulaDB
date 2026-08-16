import test from "node:test";
import assert from "node:assert/strict";
import { MysqlDriver } from "./mysql.js";
import { TEST_DB_HINT } from "./testDbAvailability.js";
import { diffTargetAgainstLive, generateMigrationSql, generateRollbackSql } from "@athanordb/dbml-engine";
import type { Project } from "@athanordb/shared";

// Matches docker-compose.test.yml's `athanordb-test-mysql` service.
const config = {
  id: "test-conn",
  projectId: "p1",
  name: "Test MySQL",
  engine: "mysql" as const,
  host: process.env.ATHANORDB_TEST_MYSQL_HOST || "localhost",
  port: Number(process.env.ATHANORDB_TEST_MYSQL_PORT || 53306),
  database: process.env.ATHANORDB_TEST_MYSQL_DATABASE || "athanordb_test",
  user: process.env.ATHANORDB_TEST_MYSQL_USER || "root",
  password: process.env.ATHANORDB_TEST_MYSQL_PASSWORD || "athanordb_test",
};

test("MysqlDriver connects, introspects, inspects risks with sample data, deploys migrations", async (t) => {
  const driver = new MysqlDriver(config);

  // testConnection() swallows connection failures into `.error` rather than
  // throwing, so "nothing's listening" is detected from that instead of a
  // thrown error's `.code`.
  const connTest = await driver.testConnection();
  if (!connTest.ok) {
    await driver.close().catch(() => {});
    t.skip(`no MySQL test container reachable at ${config.host}:${config.port} (${TEST_DB_HINT}): ${connTest.error}`);
    return;
  }

  try {
    // 1. Connection metadata
    assert.equal(connTest.ok, true);
    assert.ok(connTest.version);
    assert.equal(connTest.database, config.database);

    // 2. Clean slate for re-runs against a persistent instance.
    await driver.executeMigration(`DROP TABLE IF EXISTS users;`);

    // 3. Deploy an initial schema + seed data (apply-deployment's path).
    const initial = await driver.executeMigration(`
      START TRANSACTION;
      CREATE TABLE users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255)
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

    // 5. Diff the live DB against a target project that drops `email`, and
    // confirm the risk engine flags the data loss with samples.
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

    // 6. Generate and actually apply the migration SQL for that diff, then
    // confirm the live schema reflects it.
    const sql = generateMigrationSql(diff, "mysql", {
      [dropRisk!.id]: { strategy: "DROP_DATA_CONFIRMED" },
    });
    const applied = await driver.executeMigration(sql);
    assert.equal(applied.success, true, applied.error ?? "migration should have succeeded");
    assert.ok(applied.executedStatements > 0);

    const afterSchema = await driver.introspectSchema();
    const usersAfter = afterSchema.tables.find((tbl) => tbl.name === "users");
    assert.ok(usersAfter);
    assert.ok(!usersAfter!.fields.find((f) => f.name === "email"), "email column should be gone after deployment");

    // 7. A batch where the first statement succeeds and the second is
    // deliberately invalid: unlike Postgres/SQLite, MySQL's DDL auto-commits
    // statement-by-statement (see the driver's own comment on this), so the
    // honest, testable claim isn't "nothing landed" — it's "exactly what
    // landed is reported". `executedStatements` must be 1, not 0, and the
    // column the first statement added must actually be there.
    const broken = await driver.executeMigration(`
      ALTER TABLE users ADD COLUMN nickname VARCHAR(50);
      ALTER TABLE users ADD COLUMN bogus NOPE_NOT_A_TYPE;
    `);
    assert.equal(broken.success, false);
    assert.equal(broken.executedStatements, 1, "the first statement landed even though the batch failed overall");
    assert.match(broken.error ?? "", /statement 2 of 2/);

    const afterPartialFailure = await driver.introspectSchema();
    const usersAfterPartial = afterPartialFailure.tables.find((tbl) => tbl.name === "users");
    assert.ok(
      usersAfterPartial!.fields.find((f) => f.name === "nickname"),
      "the column added by the surviving first statement should be visible on introspection",
    );

    const stillWorks = await driver.testConnection();
    assert.equal(stillWorks.ok, true);

    // 8. Rollback, end to end: generate the rollback SQL for a fully
    // reversible change (adding a column — no data existed to lose), apply
    // it, and confirm the schema is really back to where it started.
    await driver.executeMigration(`ALTER TABLE users DROP COLUMN nickname;`); // clean slate for the diff below
    const beforeAdd = await driver.introspectSchema();
    const targetWithNickname: Project = {
      ...beforeAdd,
      tables: [
        {
          ...beforeAdd.tables.find((tbl) => tbl.name === "users")!,
          fields: [
            ...beforeAdd.tables.find((tbl) => tbl.name === "users")!.fields,
            { id: "users.nickname", name: "nickname", type: "varchar(50)" },
          ],
        },
      ],
    };
    const addDiff = diffTargetAgainstLive(beforeAdd, targetWithNickname);
    const addSql = generateMigrationSql(addDiff, "mysql", {});
    const addResult = await driver.executeMigration(addSql);
    assert.equal(addResult.success, true, addResult.error ?? "add-column migration should have succeeded");

    const { sql: rollbackSql, irreversible } = generateRollbackSql(addDiff, "mysql", {});
    assert.equal(irreversible.length, 0, "adding an empty column has nothing irreversible to flag");
    const rollbackResult = await driver.executeMigration(rollbackSql);
    assert.equal(rollbackResult.success, true, rollbackResult.error ?? "rollback should have succeeded");

    const afterRollback = await driver.introspectSchema();
    const usersAfterRollback = afterRollback.tables.find((tbl) => tbl.name === "users");
    assert.ok(
      !usersAfterRollback!.fields.find((f) => f.name === "nickname"),
      "the rollback should have removed the column the forward migration added",
    );
  } finally {
    await driver.executeMigration(`DROP TABLE IF EXISTS users;`).catch(() => {});
    await driver.close();
  }
});
