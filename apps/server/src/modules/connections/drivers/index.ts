import type { DatabaseConnectionConfig } from "@athanordb/shared";
import { ApiError } from "../../../shared/errors.js";
import { assertHostAllowed } from "../hostGuard.js";
import type { DatabaseDriver } from "./interface.js";
import { PostgresDriver } from "./postgres.js";
import { MysqlDriver } from "./mysql.js";
import { SqliteDriver } from "./sqlite.js";

export * from "./interface.js";
export * from "./postgres.js";
export * from "./mysql.js";
export * from "./sqlite.js";

/**
 * The single place every route creates a driver from — `assertHostAllowed`
 * runs here rather than inside each network driver's constructor so it's
 * impossible to add a fourth network engine later and forget to wire the
 * guard in. `async` (a change from the original sync factory) because the
 * guard resolves DNS; every call site now awaits this.
 */
export async function createDatabaseDriver(config: DatabaseConnectionConfig): Promise<DatabaseDriver> {
  switch (config.engine) {
    case "postgres":
    case "mysql":
      await assertHostAllowed(config.host);
      return config.engine === "postgres" ? new PostgresDriver(config) : new MysqlDriver(config);
    case "sqlite":
      return new SqliteDriver(config);
    default:
      throw new ApiError("CONNECTION_ENGINE_INVALID");
  }
}
