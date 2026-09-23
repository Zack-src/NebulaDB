import type { DatabaseConnectionConfig } from "@athanordb/shared";
import { ApiError } from "../../../shared/errors.js";
import { assertHostAllowed } from "../hostGuard.js";
import { takeConnectionBudget, targetKey } from "../connectionBudget.js";
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
 * The single place every route creates a driver from — `assertHostAllowed`
 * runs here rather than inside each network driver's constructor so it's
 * impossible to add a fourth network engine later and forget to wire the
 * guard in. `async` (a change from the original sync factory) because the
 * guard resolves DNS; every call site now awaits this.
 */
export async function createDatabaseDriver(config: DatabaseConnectionConfig): Promise<DatabaseDriver> {
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
    case "oracle":
      await assertHostAllowed(config.host);
      switch (config.engine) {
        case "postgres":
          return new PostgresDriver(config);
        case "mysql":
          return new MysqlDriver(config);
        case "mssql":
          return new MssqlDriver(config);
        case "oracle":
          return new OracleDriver(config);
      }
      break;
    case "sqlite":
      return new SqliteDriver(config);
    default:
      throw new ApiError("CONNECTION_ENGINE_INVALID");
  }
  throw new ApiError("CONNECTION_ENGINE_INVALID");
}
