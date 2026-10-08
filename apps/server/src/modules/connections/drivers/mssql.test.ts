import test from "node:test";
import assert from "node:assert/strict";
import { MssqlDriver } from "./mssql.js";

// Matches docker-compose.mssql.yml's `nebuladb-test-mssql` service. The tables
// live in `tempdb` so nothing is left in a real database.
const config = {
  id: "test-conn",
  projectId: "p1",
  name: "Test SQL Server",
  engine: "mssql" as const,
  host: process.env.NEBULADB_TEST_MSSQL_HOST || "localhost",
  port: Number(process.env.NEBULADB_TEST_MSSQL_PORT || 1433),
  database: process.env.NEBULADB_TEST_MSSQL_DATABASE || "tempdb",
  user: process.env.NEBULADB_TEST_MSSQL_USER || "sa",
  password: process.env.NEBULADB_TEST_MSSQL_PASSWORD || "Nebula_Test123!",
};

const DROP = `DROP TABLE IF EXISTS nebuladb_seed_child; DROP TABLE IF EXISTS nebuladb_seed_parent; DROP TABLE IF EXISTS nebuladb_seed_plain;`;

test("MssqlDriver.insertRows keeps the ids a seed gives to identity columns", async (t) => {
  const driver = new MssqlDriver(config);
  const connTest = await driver.testConnection();
  if (!connTest.ok) {
    await driver.close().catch(() => {});
    t.skip(
      `no SQL Server test container reachable at ${config.host}:${config.port} (start it with \`docker compose -f docker-compose.mssql.yml up -d\`): ${connTest.error}`,
    );
    return;
  }

  const ids = async (table: string) =>
    (await driver.queryRows(`SELECT id FROM ${table} ORDER BY id`)).map((row) => Number(row[0]));

  try {
    await driver.executeMigration(DROP);
    const created = await driver.executeMigration(`
      CREATE TABLE nebuladb_seed_parent (id INT IDENTITY(1,1) PRIMARY KEY, name NVARCHAR(50) NOT NULL);
      CREATE TABLE nebuladb_seed_child (id INT IDENTITY(1,1) PRIMARY KEY, id_parent INT NOT NULL REFERENCES nebuladb_seed_parent(id));
      CREATE TABLE nebuladb_seed_plain (id INT PRIMARY KEY, label NVARCHAR(50));
    `);
    assert.equal(created.success, true, created.error ?? "the test tables should have been created");

    // 1. Explicit ids on an identity column go in as given, 0 included.
    const inserted = await driver.insertRows(
      "nebuladb_seed_parent",
      ["id", "name"],
      [
        ["0", "zero"],
        ["10", "ten"],
        ["42", "forty-two"],
      ],
    );
    assert.equal(inserted, 3);
    assert.deepEqual(await ids("nebuladb_seed_parent"), [0, 10, 42]);

    // 2. A child seeded afterwards finds the ids it points at.
    await driver.insertRows(
      "nebuladb_seed_child",
      ["id", "id_parent"],
      [
        ["7", "42"],
        ["8", "0"],
      ],
    );
    assert.deepEqual(await ids("nebuladb_seed_child"), [7, 8]);

    // 3. Without the identity column SQL Server numbers the row itself, after the highest seeded id.
    await driver.insertRows("nebuladb_seed_parent", ["name"], [["generated"]]);
    assert.deepEqual(await ids("nebuladb_seed_parent"), [0, 10, 42, 43]);

    // 4. A failing table rolls back whole and leaves IDENTITY_INSERT off: only one table of a
    // session may hold it, so a leak would break every later insert on that pooled connection.
    await assert.rejects(
      driver.insertRows(
        "nebuladb_seed_parent",
        ["id", "name"],
        [
          ["100", "new"],
          ["42", "duplicate"],
        ],
      ),
    );
    // A conversion failure aborts the whole batch, so the `SET ... OFF` that closes it never runs.
    await assert.rejects(driver.insertRows("nebuladb_seed_parent", ["id", "name"], [["not a number", "broken"]]));
    assert.deepEqual(await ids("nebuladb_seed_parent"), [0, 10, 42, 43]);
    await driver.insertRows("nebuladb_seed_child", ["id", "id_parent"], [["9", "10"]]);
    await driver.insertRows("nebuladb_seed_parent", ["name"], [["generated again"]]);
    assert.deepEqual(await ids("nebuladb_seed_child"), [7, 8, 9]);
    assert.equal((await ids("nebuladb_seed_parent")).length, 5);

    // 5. A table without identity column is inserted as before, across several batches.
    const many = Array.from({ length: 2500 }, (_, i) => [String(i + 1), i % 2 ? `row ${i + 1}` : null]);
    assert.equal(await driver.insertRows("nebuladb_seed_plain", ["id", "label"], many), 2500);
    assert.equal(await driver.queryScalar("SELECT COUNT(*) FROM nebuladb_seed_plain"), 2500);

    // 6. Several batches on an identity table too.
    await driver.executeMigration(`DELETE FROM nebuladb_seed_child; DELETE FROM nebuladb_seed_parent;`);
    const parents = Array.from({ length: 2500 }, (_, i) => [String(1000 + i), `parent ${i}`]);
    assert.equal(await driver.insertRows("nebuladb_seed_parent", ["id", "name"], parents), 2500);
    assert.equal(await driver.queryScalar("SELECT MAX(id) FROM nebuladb_seed_parent"), 3499);
  } finally {
    await driver.executeMigration(DROP).catch(() => {});
    await driver.close();
  }
});
