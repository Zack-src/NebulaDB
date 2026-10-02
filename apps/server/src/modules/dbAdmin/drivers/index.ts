import type { DatabaseConnectionConfig } from "@athanordb/shared";
import { ApiError } from "../../../shared/errors.js";
import { takeConnectionBudget, targetKey, type BudgetKind } from "../../connections/connectionBudget.js";
import { pinConnectionTarget } from "../../connections/targetPinning.js";
import type { DatabaseAdminDriver } from "./interface.js";
import { MssqlAdminDriver } from "./mssql.js";
import { MysqlAdminDriver } from "./mysql.js";
import { OracleAdminDriver } from "./oracle.js";
import { PostgresAdminDriver } from "./postgres.js";
import { SqliteAdminDriver } from "./sqlite.js";

export * from "./interface.js";

/**
 * The one place an administration driver is created — same role as
 * `createDatabaseDriver`: the per-target budget is spent and the network
 * target is checked and pinned before any engine code runs.
 */
export async function createAdminDriver(
  config: DatabaseConnectionConfig,
  kind: BudgetKind = "admin",
): Promise<DatabaseAdminDriver> {
  takeConnectionBudget(targetKey(config), kind);
  switch (config.engine) {
    case "postgres":
      return new PostgresAdminDriver(await pinConnectionTarget(config));
    case "mysql":
      return new MysqlAdminDriver(await pinConnectionTarget(config));
    case "mssql":
      return new MssqlAdminDriver(await pinConnectionTarget(config));
    case "oracle":
      return new OracleAdminDriver(await pinConnectionTarget(config));
    case "sqlite":
      return new SqliteAdminDriver(config);
    default:
      throw new ApiError("CONNECTION_ENGINE_INVALID");
  }
}
