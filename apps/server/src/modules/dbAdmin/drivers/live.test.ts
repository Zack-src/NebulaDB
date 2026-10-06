import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { DatabaseConnectionConfig, DbUserAction } from "@nebuladb/shared";

// `drivers/sqlite.ts` (pulled in by the factory) reads the app config.
process.env.NEBULADB_DB_PATH ??= join(tmpdir(), `nebuladb-test-adminlive-${randomUUID()}.sqlite`);

const { createAdminDriver } = await import("./index.js");
const { resetConnectionBudgets } = await import("../../connections/connectionBudget.js");
const { TEST_DB_HINT } = await import("../../connections/drivers/testDbAvailability.js");

/**
 * The administration drivers against real servers: the throwaway containers
 * of `docker-compose.test.yml` (PostgreSQL, MySQL), `docker-compose.mssql.yml`
 * (SQL Server) and `docker-compose.oracle.yml` (Oracle). Each test skips
 * itself when its server isn't reachable, like the deployment driver tests.
 */
const env = process.env;
const base = { id: "admin-live", projectId: "", name: "Admin live" };
const TARGETS: Record<"postgres" | "mysql" | "mssql" | "oracle", DatabaseConnectionConfig> = {
  postgres: {
    ...base,
    engine: "postgres",
    host: env.NEBULADB_TEST_PG_HOST || "localhost",
    port: Number(env.NEBULADB_TEST_PG_PORT || 55432),
    database: env.NEBULADB_TEST_PG_DATABASE || "nebuladb_test",
    user: env.NEBULADB_TEST_PG_USER || "nebuladb_test",
    password: env.NEBULADB_TEST_PG_PASSWORD || "nebuladb_test",
  },
  mysql: {
    ...base,
    engine: "mysql",
    host: env.NEBULADB_TEST_MYSQL_HOST || "localhost",
    port: Number(env.NEBULADB_TEST_MYSQL_PORT || 53306),
    database: env.NEBULADB_TEST_MYSQL_DATABASE || "nebuladb_test",
    user: env.NEBULADB_TEST_MYSQL_USER || "root",
    password: env.NEBULADB_TEST_MYSQL_PASSWORD || "nebuladb_test",
  },
  mssql: {
    ...base,
    engine: "mssql",
    host: env.NEBULADB_TEST_MSSQL_HOST || "localhost",
    port: Number(env.NEBULADB_TEST_MSSQL_PORT || 1433),
    database: "master",
    user: env.NEBULADB_TEST_MSSQL_USER || "sa",
    password: env.NEBULADB_TEST_MSSQL_PASSWORD || "Nebula_Test123!",
  },
  oracle: {
    ...base,
    engine: "oracle",
    host: env.NEBULADB_TEST_ORACLE_HOST || "localhost",
    port: Number(env.NEBULADB_TEST_ORACLE_PORT || 51521),
    database: env.NEBULADB_TEST_ORACLE_SERVICE || "FREEPDB1",
    user: env.NEBULADB_TEST_ORACLE_USER || "system",
    password: env.NEBULADB_TEST_ORACLE_PASSWORD || "nebuladb_test",
  },
};

const QUOTES = { postgres: ['"', '"'], mysql: ["`", "`"], mssql: ["[", "]"], oracle: ['"', '"'] } as const;
const WRITE = { readOnly: false, timeoutMs: 20_000, maxRows: 100 };
const READ = { readOnly: true, timeoutMs: 20_000, maxRows: 100 };

async function open(t: TestContext, engine: keyof typeof TARGETS) {
  resetConnectionBudgets();
  const driver = await createAdminDriver(TARGETS[engine]);
  try {
    await driver.listDatabases();
    return driver;
  } catch (err) {
    await driver.close().catch(() => {});
    t.skip(`no ${engine} test server reachable (${TEST_DB_HINT}): ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/** Everything but Oracle, which has neither `CREATE DATABASE` nor a server/database split to exercise. */
for (const engine of ["postgres", "mysql", "mssql"] as const) {
  test(`${engine} admin driver: explore, query with the read-only guard, manage a user, drop`, async (t) => {
    const driver = await open(t, engine);
    if (!driver) return;
    const [l, r] = QUOTES[engine];
    const q = (name: string) => `${l}${name}${r}`;
    const database = "nebula_admin_live";
    const schema = engine === "postgres" ? "public" : engine === "mssql" ? "dbo" : undefined;
    const table = { database, schema, table: "items" };
    const user = { name: "nebula_admin_live_user", host: engine === "mysql" ? "%" : undefined };
    // SQL Server keeps a server login and a per-database user; elsewhere they are one and the same.
    const dbUser = engine === "mssql" ? { ...user, database } : user;
    const apply = async (action: DbUserAction, runIn?: string) => {
      const statements = driver.userStatements(action);
      await driver.execute(statements, runIn);
      return statements.map((s) => s.display);
    };
    const cleanup = async () => {
      if (engine === "mssql") await apply({ type: "drop", principal: dbUser }, database).catch(() => {});
      await apply({ type: "drop", principal: user }).catch(() => {});
      await driver.execute(driver.dropStatements("database", { database })).catch(() => {});
    };

    try {
      await cleanup();
      await driver.runQuery(`CREATE DATABASE ${q(database)}`, WRITE);
      const databases = await driver.listDatabases();
      assert.equal(databases.find((d) => d.name === database)?.system, false);
      assert.ok(
        databases.some((d) => d.system),
        "system databases are flagged",
      );

      await driver.runQuery(
        `CREATE TABLE ${q("items")} (id INT PRIMARY KEY, label VARCHAR(50) NOT NULL, price DECIMAL(10,2) DEFAULT 0, note VARCHAR(20))`,
        { ...WRITE, database },
      );
      const inserted = await driver.runQuery(
        `INSERT INTO ${q("items")} (id, label) VALUES (1, 'a'), (2, 'b'), (3, 'c')`,
        { ...WRITE, database },
      );
      assert.equal(inserted.rowCount, 3);
      await driver.runQuery(`CREATE VIEW ${q("v_items")} AS SELECT id, label FROM ${q("items")}`, {
        ...WRITE,
        database,
      });

      const tables = await driver.listTables(database, schema);
      assert.deepEqual(
        tables.map((x) => [x.name, x.kind]),
        [
          ["items", "table"],
          ["v_items", "view"],
        ],
      );

      const description = await driver.describeTable(table);
      assert.deepEqual(
        description.columns.map((c) => c.name),
        ["id", "label", "price", "note"],
      );
      assert.deepEqual(
        description.columns.map((c) => c.primaryKey),
        [true, false, false, false],
      );
      assert.deepEqual(
        description.columns.map((c) => c.nullable),
        [false, false, true, true],
      );
      assert.ok(description.indexes.some((i) => i.primary && i.columns.join() === "id"));
      assert.ok(description.constraints.some((c) => c.type === "PRIMARY KEY"));

      const page = await driver.browseRows(table, { limit: 2, offset: 0 });
      assert.equal(page.rows.length, 2);
      assert.equal(page.truncated, true);
      assert.equal((await driver.browseRows(table, { limit: 2, offset: 2 })).truncated, false);

      const selected = await driver.runQuery(`SELECT id, label FROM ${q("items")} ORDER BY id;`, { ...READ, database });
      assert.deepEqual(selected.columns, ["id", "label"]);
      assert.deepEqual(selected.rows, [
        [1, "a"],
        [2, "b"],
        [3, "c"],
      ]);
      const capped = await driver.runQuery(`SELECT * FROM ${q("items")}`, { ...READ, database, maxRows: 2 });
      assert.deepEqual([capped.rows.length, capped.truncated], [2, true]);

      // Read-only mode: nothing below may change a row.
      const blocked = { code: "DB_ADMIN_WRITE_NOT_ALLOWED" };
      await assert.rejects(driver.runQuery(`DELETE FROM ${q("items")}`, { ...READ, database }), blocked);
      await assert.rejects(driver.runQuery(`SELECT 1; DELETE FROM ${q("items")}`, { ...READ, database }), blocked);
      if (engine === "postgres") {
        await assert.rejects(
          driver.runQuery(`WITH gone AS (DELETE FROM "items" RETURNING id) SELECT * FROM gone`, { ...READ, database }),
        );
        await assert.rejects(
          driver.runQuery(`SELECT nextval('nope'); COMMIT; DELETE FROM "items"`, { ...READ, database }),
        );
      }
      if (engine === "mssql")
        await assert.rejects(driver.runQuery("SELECT 1 DELETE FROM items", { ...READ, database }), blocked);
      const count = await driver.runQuery(`SELECT COUNT(*) FROM ${q("items")}`, { ...READ, database });
      assert.equal(Number(count.rows[0][0]), 3);

      // Accounts and privileges.
      assert.match(
        (await apply({ type: "create", principal: user, password: "P@ss'w0rd-Live1" }))[0],
        /\*{8}/,
        "the password is masked in what is shown",
      );
      if (engine === "mssql") await apply({ type: "create", principal: dbUser }, database);
      const listed = (await driver.listPrincipals()).find((p) => p.name === user.name);
      assert.deepEqual([listed?.kind, listed?.canLogin, listed?.system], ["user", true, false]);

      await apply(
        { type: "grant", principal: dbUser, scope: "table", privileges: ["SELECT", "UPDATE"], target: table },
        database,
      );
      const tableGrants = async () =>
        (await driver.listGrants({ ...user, database }))
          .filter((g) => g.scope === "table" && g.table === "items")
          .flatMap((g) => g.privileges)
          .sort();
      assert.deepEqual(await tableGrants(), ["SELECT", "UPDATE"]);
      await apply(
        { type: "revoke", principal: dbUser, scope: "table", privileges: ["UPDATE"], target: table },
        database,
      );
      assert.deepEqual(await tableGrants(), ["SELECT"]);

      assert.throws(
        () =>
          driver.userStatements({
            type: "grant",
            principal: dbUser,
            scope: "table",
            privileges: ["SELECT; DROP TABLE items"],
            target: table,
          }),
        { code: "DB_ADMIN_INPUT_INVALID" },
      );

      await apply({ type: "password", principal: user, password: "N3w'pass-Live2" });
      await apply({ type: "lock", principal: user, locked: true });
      assert.equal((await driver.listPrincipals()).find((p) => p.name === user.name)?.canLogin, false);
      await apply({ type: "lock", principal: user, locked: false });
      assert.equal((await driver.listPrincipals()).find((p) => p.name === user.name)?.canLogin, true);

      assert.ok(Array.isArray(await driver.listSessions()));
      const counters = await driver.readCounters();
      assert.ok(counters.queries === null || counters.queries >= 0, "queries counter");
      assert.throws(() => driver.killSessionStatements("1; DROP TABLE items"), { code: "DB_ADMIN_INPUT_INVALID" });

      // Drops, smallest first.
      await driver.execute(driver.dropStatements("column", { ...table, column: "note" }), database);
      assert.deepEqual(
        (await driver.describeTable(table)).columns.map((c) => c.name),
        ["id", "label", "price"],
      );
      await driver.execute(driver.dropStatements("view", { ...table, table: "v_items" }), database);
      await driver.execute(driver.dropStatements("table", table), database);
      assert.deepEqual(await driver.listTables(database, schema), []);
      const systemDatabase = databases.find((d) => d.system)!.name;
      assert.throws(() => driver.dropStatements("database", { database: systemDatabase }), {
        code: "DB_ADMIN_SYSTEM_OBJECT",
      });
    } finally {
      await cleanup();
      await driver.close();
    }
    const after = await createAdminDriver(TARGETS[engine]);
    try {
      assert.ok(!(await after.listDatabases()).some((d) => d.name === database), "the database is gone");
    } finally {
      await after.close();
    }
  });
}

test("oracle admin driver: explore, query with the read-only guard, manage a user, drop", async (t) => {
  const driver = await open(t, "oracle");
  if (!driver) return;
  const user = { name: "NEBULA_ADMIN_LIVE" };
  // The objects live in a schema of their own: the connecting account's (SYSTEM) is Oracle-maintained, and off limits.
  const owner = "NEBULA_LIVE_OWNER";
  const table = { schema: owner, table: "ITEMS" };
  const apply = async (action: DbUserAction) => {
    const statements = driver.userStatements(action);
    await driver.execute(statements);
    return statements.map((s) => s.display);
  };
  const cleanup = async () => {
    await apply({ type: "drop", principal: user }).catch(() => {});
    await driver.runQuery(`DROP USER ${owner} CASCADE`, WRITE).catch(() => {});
  };
  try {
    await cleanup();
    assert.equal(driver.capabilities.multiDatabase, false);
    assert.ok((await driver.listSchemas()).some((s) => s.name === "SYS" && s.system));

    await apply({ type: "create", principal: { name: owner }, password: "Owner-Live_1" });
    await driver.runQuery(`ALTER USER ${owner} QUOTA UNLIMITED ON USERS`, WRITE);
    await driver.runQuery(
      `CREATE TABLE ${owner}.ITEMS (id NUMBER(10) PRIMARY KEY, label VARCHAR2(50) NOT NULL, note VARCHAR2(20))`,
      WRITE,
    );
    for (const [id, label] of [
      [1, "a"],
      [2, "b"],
      [3, "c"],
    ]) {
      await driver.runQuery(`INSERT INTO ${owner}.ITEMS (id, label) VALUES (${id}, '${label}')`, WRITE);
    }
    await driver.runQuery(`CREATE VIEW ${owner}.V_ITEMS AS SELECT id FROM ${owner}.ITEMS`, WRITE);

    const tables = await driver.listTables(undefined, owner);
    assert.deepEqual(
      tables.map((x) => [x.name, x.kind]),
      [
        ["ITEMS", "table"],
        ["V_ITEMS", "view"],
      ],
    );
    const description = await driver.describeTable(table);
    assert.deepEqual(
      description.columns.map((c) => [c.name, c.primaryKey, c.nullable]),
      [
        ["ID", true, false],
        ["LABEL", false, false],
        ["NOTE", false, true],
      ],
    );
    assert.ok(description.constraints.some((c) => c.type === "PRIMARY KEY"));

    const page = await driver.browseRows(table, { limit: 2, offset: 0 });
    assert.deepEqual([page.rows.length, page.truncated], [2, true]);
    const selected = await driver.runQuery(`SELECT id, label FROM ${owner}.ITEMS ORDER BY id;`, READ);
    assert.deepEqual(selected.rows, [
      [1, "a"],
      [2, "b"],
      [3, "c"],
    ]);
    await assert.rejects(driver.runQuery(`DELETE FROM ${owner}.ITEMS`, READ), { code: "DB_ADMIN_WRITE_NOT_ALLOWED" });

    assert.match((await apply({ type: "create", principal: user, password: "Pass-Live_1" }))[0], /\*{8}/);
    assert.throws(() => driver.userStatements({ type: "password", principal: user, password: 'a"b' }), {
      code: "DB_ADMIN_INPUT_INVALID",
    });
    await apply({ type: "grant", principal: user, scope: "server", privileges: ["CREATE SESSION"] });
    await apply({ type: "grant", principal: user, scope: "table", privileges: ["SELECT", "UPDATE"], target: table });
    await apply({ type: "revoke", principal: user, scope: "table", privileges: ["UPDATE"], target: table });
    const grants = await driver.listGrants(user);
    assert.deepEqual(grants.find((g) => g.scope === "server")?.privileges, ["CREATE SESSION"]);
    assert.deepEqual(grants.find((g) => g.scope === "table")?.privileges, ["SELECT"]);

    await apply({ type: "lock", principal: user, locked: true });
    assert.equal((await driver.listPrincipals()).find((p) => p.name === user.name)?.locked, true);
    await apply({ type: "lock", principal: user, locked: false });
    const principals = await driver.listPrincipals();
    assert.equal(principals.find((p) => p.name === user.name)?.locked, false);
    assert.equal(principals.find((p) => p.name === "SYS")?.system, true);

    assert.ok(Array.isArray(await driver.listSessions()));
    const counters = await driver.readCounters();
    assert.ok(counters.queries === null || counters.queries >= 0, "queries counter");
    assert.throws(() => driver.killSessionStatements("12"), { code: "DB_ADMIN_INPUT_INVALID" });

    await driver.execute(driver.dropStatements("column", { ...table, column: "NOTE" }));
    assert.deepEqual(
      (await driver.describeTable(table)).columns.map((c) => c.name),
      ["ID", "LABEL"],
    );
    await driver.execute(driver.dropStatements("view", { ...table, table: "V_ITEMS" }));
    await driver.execute(driver.dropStatements("table", table));
    assert.deepEqual(await driver.listTables(undefined, owner), []);
    assert.throws(() => driver.dropStatements("database", {}), { code: "DB_ADMIN_UNSUPPORTED" });
    assert.throws(() => driver.dropStatements("table", { schema: "SYSTEM", table: "HELP" }), {
      code: "DB_ADMIN_SYSTEM_OBJECT",
    });
  } finally {
    await cleanup();
    await driver.close();
  }
});
