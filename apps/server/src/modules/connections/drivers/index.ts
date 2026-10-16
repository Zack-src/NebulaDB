import type { DatabaseConnectionConfig } from "@nebuladb/shared";
import { ApiError } from "../../../shared/errors.js";
import { reachTarget, withTunnel } from "../sshTunnel.js";
import { takeConnectionBudget, targetKey } from "../connectionBudget.js";
import { configForActor } from "../personalCredentials.js";
import { normalizeSecurity } from "../security.js";
import type { DatabaseDriver, DriverConnectionConfig, TestConnectionResult } from "./interface.js";
import { PostgresDriver } from "./postgres.js";
import { MysqlDriver } from "./mysql.js";
import { SqliteDriver } from "./sqlite.js";
import { MssqlDriver } from "./mssql.js";
import { OracleDriver } from "./oracle.js";
import { BigQueryDriver } from "./bigquery.js";

export * from "./interface.js";
export * from "./postgres.js";
export * from "./mysql.js";
export * from "./sqlite.js";
export * from "./mssql.js";
export * from "./oracle.js";
export * from "./bigquery.js";

/**
 * The single place every route creates a driver from — `pinConnectionTarget`
 * (host guard + DNS pinning) runs here rather than inside each network
 * driver's constructor so it's impossible to add another network engine
 * later and forget to wire the guard in. `async` because it resolves DNS.
 *
 * Also where a connection in `personal` mode gets the account of whoever is
 * asking (`configForActor`) — before the budget is spent, so someone without
 * an account is refused without touching the target.
 */
export async function createDatabaseDriver(stored: DatabaseConnectionConfig): Promise<DatabaseDriver> {
  const config = await configForActor(stored);
  const key = targetKey(config);
  takeConnectionBudget(key, "connect");
  return withWriteBudget(await openDriver(config), key);
}

/** Every `executeMigration` (deploy, rollback) also spends the much smaller per-target write budget. */
function withWriteBudget(driver: DatabaseDriver, key: string): DatabaseDriver {
  const execute = driver.executeMigration.bind(driver);
  driver.executeMigration = (sql: string) => {
    takeConnectionBudget(key, "write");
    return execute(sql);
  };
  return driver;
}

async function openDriver(config: DatabaseConnectionConfig): Promise<DatabaseDriver> {
  switch (config.engine) {
    case "postgres":
    case "mysql":
    case "mssql":
    case "oracle": {
      const { config: target, tunnel } = await reachTarget(config);
      try {
        return withTunnel(openNetworkDriver(target), tunnel);
      } catch (err) {
        await tunnel?.close();
        throw err;
      }
    }
    case "sqlite":
      return new SqliteDriver(config);
    case "bigquery":
      // No host of the user's to resolve or pin: the client only ever talks to Google's own API.
      return new BigQueryDriver(config);
    default:
      throw new ApiError("CONNECTION_ENGINE_INVALID");
  }
}

function openNetworkDriver(config: DriverConnectionConfig): DatabaseDriver {
  switch (config.engine) {
    case "postgres":
      return new PostgresDriver(config);
    case "mysql":
      return new MysqlDriver(config);
    case "mssql":
      return new MssqlDriver(config);
    default:
      return new OracleDriver(config);
  }
}

/**
 * A connection test, as the forms run it: a config that cannot be checked,
 * or an SSH server that refuses, is an answer (`ok: false`) rather than an
 * error — with the host key that answered, so the form can show it.
 */
export async function testConnectionConfig(config: DatabaseConnectionConfig): Promise<TestConnectionResult> {
  normalizeSecurity(config);
  let driver: DatabaseDriver;
  try {
    driver = await createDatabaseDriver(config);
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== "CONNECTION_SSH_FAILED") throw err;
    const seen = err.details?.sshHostKeyFingerprint;
    return { ok: false, error: err.message, ...(typeof seen === "string" ? { sshHostKeyFingerprint: seen } : {}) };
  }
  try {
    return await driver.testConnection();
  } finally {
    await driver.close().catch(() => {});
  }
}
