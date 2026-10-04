import type { DatabaseConnectionConfig } from "@athanordb/shared";
import { ApiError } from "../../../shared/errors.js";
import { pinConnectionTarget } from "../targetPinning.js";
import { takeConnectionBudget, targetKey } from "../connectionBudget.js";
import { configForActor } from "../personalCredentials.js";
import type { DatabaseDriver } from "./interface.js";
import { PostgresDriver } from "./postgres.js";
import { MysqlDriver } from "./mysql.js";
import { SqliteDriver } from "./sqlite.js";
import { MssqlDriver } from "./mssql.js";
import { OracleDriver } from "./oracle.js";

export * from "./interface.js";
export * from "./postgres.js";
export * from "./mysql.js";
export * from "./sqlite.js";
export * from "./mssql.js";
export * from "./oracle.js";

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
  const config = configForActor(stored);
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
      return new PostgresDriver(await pinConnectionTarget(config));
    case "mysql":
      return new MysqlDriver(await pinConnectionTarget(config));
    case "mssql":
      return new MssqlDriver(await pinConnectionTarget(config));
    case "oracle":
      return new OracleDriver(await pinConnectionTarget(config));
    case "sqlite":
      return new SqliteDriver(config);
    default:
      throw new ApiError("CONNECTION_ENGINE_INVALID");
  }
}
