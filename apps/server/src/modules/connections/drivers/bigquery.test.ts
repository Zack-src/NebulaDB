import test from "node:test";
import assert from "node:assert/strict";
import { diffTargetAgainstLive, generateMigrationSql } from "@nebuladb/dbml-engine";
import type { Project } from "@nebuladb/shared";
import { BigQueryDriver, bigQueryColumnType, bigQueryValueExpression } from "./bigquery.js";

test("bigQueryColumnType writes a column's type the way a CREATE TABLE would", () => {
  assert.equal(bigQueryColumnType({ name: "a", type: "INTEGER" }), "INT64");
  assert.equal(bigQueryColumnType({ name: "a", type: "FLOAT" }), "FLOAT64");
  assert.equal(bigQueryColumnType({ name: "a", type: "BOOLEAN" }), "BOOL");
  assert.equal(bigQueryColumnType({ name: "a", type: "STRING" }), "STRING");
  assert.equal(bigQueryColumnType({ name: "a", type: "STRING", maxLength: "255" }), "STRING(255)");
  assert.equal(bigQueryColumnType({ name: "a", type: "NUMERIC", precision: "18", scale: "6" }), "NUMERIC(18,6)");
  assert.equal(bigQueryColumnType({ name: "a", type: "NUMERIC", precision: "10" }), "NUMERIC(10)");
  assert.equal(bigQueryColumnType({ name: "a", type: "DATETIME" }), "DATETIME");
  assert.equal(bigQueryColumnType({ name: "a", type: "INTEGER", mode: "REPEATED" }), "ARRAY<INT64>");
});

test("bigQueryValueExpression casts the text of a seed value to its column's type", () => {
  assert.equal(bigQueryValueExpression("STRING", 0), "JSON_VALUE(r, '$[0]')");
  assert.equal(bigQueryValueExpression("INTEGER", 3), "CAST(JSON_VALUE(r, '$[3]') AS INT64)");
  assert.equal(bigQueryValueExpression("NUMERIC", 1), "CAST(JSON_VALUE(r, '$[1]') AS NUMERIC)");
  assert.equal(bigQueryValueExpression("DATETIME", 1), "CAST(JSON_VALUE(r, '$[1]') AS DATETIME)");
  assert.ok(bigQueryValueExpression("BOOLEAN", 2).includes("WHEN '1' THEN 'true'"), "1 / 0 are booleans too");
  assert.equal(bigQueryValueExpression("BYTES", 0), "FROM_BASE64(JSON_VALUE(r, '$[0]'))");
  assert.equal(bigQueryValueExpression(undefined, 0), "JSON_VALUE(r, '$[0]')");
});

test("BigQueryDriver reports what a connection lacks instead of throwing", async () => {
  assert.match((await new BigQueryDriver(config({ host: "", database: "d" })).testConnection()).error ?? "", /project/);
  assert.match((await new BigQueryDriver(config({ host: "p", database: "" })).testConnection()).error ?? "", /dataset/);
  const badKey = await new BigQueryDriver(config({ host: "p", database: "d", password: "{not json" })).testConnection();
  assert.equal(badKey.ok, false);
  assert.match(badKey.error ?? "", /not valid JSON/);
});

function config(overrides: { host?: string; database?: string; password?: string }) {
  return { id: "test-conn", projectId: "p1", name: "Test BigQuery", engine: "bigquery" as const, ...overrides };
}

// A real dataset, named by the environment: there is no local BigQuery to start. It must exist and be empty of
// the three tables below; credentials are the machine's (`gcloud auth application-default login`) unless
// NEBULADB_TEST_BIGQUERY_KEY holds a service account key.
const live = {
  host: process.env.NEBULADB_TEST_BIGQUERY_PROJECT ?? "",
  database: process.env.NEBULADB_TEST_BIGQUERY_DATASET ?? "",
  password: process.env.NEBULADB_TEST_BIGQUERY_KEY,
};
const DROP = "DROP TABLE IF EXISTS `nebuladb_seed_child`; DROP TABLE IF EXISTS `nebuladb_seed_parent`;";

test("BigQueryDriver deploys a schema, takes seeds and reads the schema back unchanged", async (t) => {
  if (!live.host || !live.database) {
    t.skip("set NEBULADB_TEST_BIGQUERY_PROJECT and NEBULADB_TEST_BIGQUERY_DATASET to run against a real dataset");
    return;
  }
  const driver = new BigQueryDriver(config(live));
  const connTest = await driver.testConnection();
  if (!connTest.ok) {
    t.skip(`dataset ${live.host}.${live.database} not reachable: ${connTest.error}`);
    return;
  }

  const target: Project = {
    id: "p1",
    name: "Test",
    tables: [
      {
        id: "parent",
        name: "nebuladb_seed_parent",
        fields: [
          { id: "p.id", name: "id", type: "int", pk: true, increment: true },
          { id: "p.name", name: "name", type: "varchar(50)", notNull: true },
          { id: "p.note", name: "note", type: "varchar(max)" },
          { id: "p.amount", name: "amount", type: "decimal(18,6)" },
          { id: "p.active", name: "active", type: "bit" },
          { id: "p.created", name: "created", type: "datetime2", default: "GETDATE()", defaultKind: "expression" },
        ],
        indexes: [],
        position: { x: 0, y: 0 },
        detailLevel: "standard",
      },
      {
        id: "child",
        name: "nebuladb_seed_child",
        fields: [
          { id: "c.id", name: "id", type: "int", pk: true },
          { id: "c.id_parent", name: "id_parent", type: "int" },
        ],
        indexes: [],
        position: { x: 0, y: 0 },
        detailLevel: "standard",
      },
    ],
    refs: [
      {
        id: "r1",
        from: { tableId: "child", fieldId: "c.id_parent" },
        to: { tableId: "parent", fieldId: "p.id" },
        cardinality: "one-to-many",
      },
    ],
    enums: [],
    zones: [],
    stickyNotes: [],
    tableGroups: [],
  };
  const mine = (project: Project): Project => {
    const tables = project.tables.filter((table) => table.name.startsWith("nebuladb_seed_"));
    const ids = new Set(tables.map((table) => table.id));
    return { ...project, tables, refs: project.refs.filter((ref) => ids.has(ref.from.tableId)) };
  };

  try {
    await driver.executeMigration(DROP);
    const before = mine(await driver.introspectSchema());
    assert.equal(before.tables.length, 0);

    // 1. The pipeline of a deployment: diff against the live dataset, generate, execute.
    const sql = generateMigrationSql(diffTargetAgainstLive(before, target), "bigquery");
    const applied = await driver.executeMigration(sql);
    assert.equal(applied.success, true, applied.error ?? "the migration should have run");
    assert.equal(applied.executedStatements, 3);

    // 2. Read back, the schema is what was asked for: nothing left to deploy.
    const after = mine(await driver.introspectSchema());
    assert.deepEqual(after.tables.map((table) => table.name).sort(), ["nebuladb_seed_child", "nebuladb_seed_parent"]);
    assert.equal(after.refs.length, 1);
    assert.equal(diffTargetAgainstLive(after, target).hasChanges, false, "a second plan must find nothing to do");

    // 3. Seeds: text values, as a CSV gives them — 0 as an id, a null, a quote, a boolean spelt 1.
    const inserted = await driver.insertRows(
      "nebuladb_seed_parent",
      ["id", "name", "note", "amount", "active", "created"],
      [
        ["0", "zero", null, "1.500000", "true", "2026-10-05 13:50:44.743"],
        ["10", 'ten "quoted", with a comma', "é\nline two", "-12.25", "1", null],
        ["42", "forty-two", "", null, "false", null],
      ],
    );
    assert.equal(inserted, 3);
    await driver.insertRows("nebuladb_seed_child", ["id", "id_parent"], [["1", "42"]]);
    assert.equal(await driver.queryScalar("SELECT COUNT(*) FROM `nebuladb_seed_parent`"), 3);
    const rows = await driver.queryRows(
      "SELECT id, name, note, CAST(amount AS STRING), active, CAST(created AS STRING) FROM `nebuladb_seed_parent` ORDER BY id",
    );
    assert.deepEqual(rows[0], [0, "zero", null, "1.5", true, "2026-10-05 13:50:44.743"]);
    assert.deepEqual(rows[1].slice(0, 5), [10, 'ten "quoted", with a comma', "é\nline two", "-12.25", true]);
    assert.deepEqual(rows[2].slice(0, 5), [42, "forty-two", "", null, false]);

    // 4. A value that does not fit its column refuses the whole insert.
    await assert.rejects(
      driver.insertRows(
        "nebuladb_seed_child",
        ["id", "id_parent"],
        [
          ["2", "1"],
          ["x", "1"],
        ],
      ),
    );
    assert.equal(await driver.queryScalar("SELECT COUNT(*) FROM `nebuladb_seed_child`"), 1);

    // 5. A failing statement stops the migration and says how far it went.
    const broken = await driver.executeMigration(
      "ALTER TABLE `nebuladb_seed_child` ADD COLUMN extra STRING; ALTER TABLE `nebuladb_missing` ADD COLUMN x STRING;",
    );
    assert.equal(broken.success, false);
    assert.equal(broken.executedStatements, 1);
  } finally {
    await driver.executeMigration(DROP).catch(() => {});
    await driver.close();
  }
});
