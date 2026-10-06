import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { DatabaseConnectionConfig, DbUserAction } from "@nebuladb/shared";

process.env.NEBULADB_DB_PATH ??= join(tmpdir(), `nebuladb-test-accountlive-${randomUUID()}.sqlite`);

const { createAdminDriver } = await import("../dbAdmin/drivers/index.js");
const { resetConnectionBudgets } = await import("../connections/connectionBudget.js");
const { TEST_DB_HINT } = await import("../connections/drivers/testDbAvailability.js");
const { readAccountLines } = await import("./accountReader.js");
const { diffAccountLines, hashAccountLines, summarizeAccountChanges } = await import("./accountFingerprint.js");

/**
 * The accounts watch's read against real servers (the throwaway containers
 * of `docker-compose.test.yml` and `docker-compose.mssql.yml`): the same state
 * read twice gives the same fingerprint, and an account created, given a
 * privilege and locked shows up as exactly that. Skips without a server.
 */
const env = process.env;
const base = { id: "account-live", projectId: "", name: "Account live" };
const TARGETS: Record<"postgres" | "mysql" | "mssql", DatabaseConnectionConfig> = {
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
};
const QUOTES = { postgres: ['"', '"'], mysql: ["`", "`"], mssql: ["[", "]"] } as const;
const WRITE = { readOnly: false, timeoutMs: 20_000, maxRows: 100 };

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

for (const engine of ["postgres", "mysql", "mssql"] as const) {
  test(`${engine}: the accounts fingerprint is stable and sees an account created, granted and locked`, async (t) => {
    const driver = await open(t, engine);
    if (!driver) return;
    const [l, r] = QUOTES[engine];
    const q = (name: string) => `${l}${name}${r}`;
    const database = "nebula_watch_live";
    const schema = engine === "postgres" ? "public" : engine === "mssql" ? "dbo" : undefined;
    const table = { database, schema, table: "items" };
    const user = { name: "nebula_watch_live_user", host: engine === "mysql" ? "%" : undefined };
    const dbUser = engine === "mssql" ? { ...user, database } : user;
    const key = engine === "mysql" ? `${user.name}@%` : user.name;
    const grantKey = engine === "mssql" ? `${database}/${user.name}` : key;
    // PostgreSQL reads a table grant in the database it is in; SQL Server reads that database's users.
    const read = () => readAccountLines(driver, engine === "mysql" ? undefined : database);
    const apply = (action: DbUserAction, runIn?: string) => driver.execute(driver.userStatements(action), runIn);
    const cleanup = async () => {
      if (engine === "mssql") await apply({ type: "drop", principal: dbUser }, database).catch(() => {});
      if (engine === "postgres") {
        await driver.runQuery(`DROP OWNED BY ${q(user.name)}`, { ...WRITE, database }).catch(() => {});
      }
      await driver.execute(driver.dropStatements("database", { database })).catch(() => {});
      await apply({ type: "drop", principal: user }).catch(() => {});
    };
    const changesBetween = (before: string[], after: string[]) => {
      const { added, removed } = diffAccountLines(before, after);
      // Other test files create and drop accounts on the same server at the same time: only this test's own account counts.
      return summarizeAccountChanges(added, removed)
        .filter((c) => c.principal.includes(user.name))
        .map((c) => `${c.type} ${c.principal}${c.privilege ? ` ${c.privilege}` : ""}${c.object ? ` ${c.object}` : ""}`);
    };
    // The same state read twice agrees — retried, because another file's account changes can land between two reads.
    const readStable = async () => {
      let previous = await read();
      for (let attempt = 0; attempt < 5; attempt++) {
        const next = await read();
        if (hashAccountLines(next) === hashAccountLines(previous)) return { lines: next, stable: true };
        previous = next;
      }
      return { lines: previous, stable: false };
    };

    try {
      await cleanup();
      await driver.runQuery(`CREATE DATABASE ${q(database)}`, WRITE);
      await driver.runQuery(`CREATE TABLE ${q("items")} (id INT PRIMARY KEY)`, { ...WRITE, database });

      const { lines: first, stable } = await readStable();
      assert.ok(first.length > 0);
      assert.ok(stable, "two reads of the same state agree");
      assert.ok(!first.some((line) => /password|hash/i.test(JSON.parse(line)[2] ?? "")));

      await apply({ type: "create", principal: user, password: "Watch-Live_1x" });
      if (engine === "mssql") await apply({ type: "create", principal: dbUser }, database);
      const created = await read();
      const createdChanges = changesBetween(first, created);
      assert.ok(createdChanges.includes(`created ${key}`), createdChanges.join("\n"));

      await apply(
        { type: "grant", principal: dbUser, scope: "table", privileges: ["SELECT"], target: table },
        database,
      );
      const granted = await read();
      const object = `${database}${schema ? `.${schema}` : ""}.items`;
      assert.deepEqual(changesBetween(created, granted), [`privilege-granted ${grantKey} SELECT ${object}`]);

      await apply({ type: "lock", principal: user, locked: true });
      const locked = await read();
      assert.deepEqual(changesBetween(granted, locked), [
        engine === "postgres" ? `login-removed ${key}` : `locked ${key}`,
      ]);
    } finally {
      await cleanup();
      await driver.close();
    }
  });
}
