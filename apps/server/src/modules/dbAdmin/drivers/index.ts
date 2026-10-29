import type { DatabaseConnectionConfig } from "@nebuladb/shared";
import { ApiError } from "../../../shared/errors.js";
import { takeConnectionBudget, targetKey, type BudgetKind } from "../../connections/connectionBudget.js";
import { configForActor } from "../../connections/personalCredentials.js";
import type { DriverConnectionConfig } from "../../connections/drivers/interface.js";
import { reachTarget, withTunnel } from "../../connections/sshTunnel.js";
import type { DatabaseAdminDriver } from "./interface.js";
import { BigQueryAdminDriver } from "./bigquery.js";
import { MssqlAdminDriver } from "./mssql.js";
import { MysqlAdminDriver } from "./mysql.js";
import { OracleAdminDriver } from "./oracle.js";
import { PostgresAdminDriver } from "./postgres.js";
import { SqliteAdminDriver } from "./sqlite.js";

export * from "./interface.js";

/**
 * The one place an administration driver is created — same role as
 * `createDatabaseDriver`: the per-target budget is spent and the network
 * target is checked and pinned before any engine code runs — and a
 * connection in `personal` mode is opened with the caller's own account.
 */
export async function createAdminDriver(
  stored: DatabaseConnectionConfig,
  kind: BudgetKind = "admin",
): Promise<DatabaseAdminDriver> {
  const config = await configForActor(stored);
  takeConnectionBudget(targetKey(config), kind);
  switch (config.engine) {
    case "postgres":
    case "mysql":
    case "mssql":
    case "oracle": {
      const { config: target, tunnel } = await reachTarget(config);
      try {
        return withTunnel(openNetworkAdminDriver(target), tunnel);
      } catch (err) {
        await tunnel?.close();
        throw err;
      }
    }
    case "sqlite":
      return new SqliteAdminDriver(config);
    case "bigquery":
      return new BigQueryAdminDriver(config);
    default:
      throw new ApiError("CONNECTION_ENGINE_INVALID");
  }
}

function openNetworkAdminDriver(config: DriverConnectionConfig): DatabaseAdminDriver {
  switch (config.engine) {
    case "postgres":
      return new PostgresAdminDriver(config);
    case "mysql":
      return new MysqlAdminDriver(config);
    case "mssql":
      return new MssqlAdminDriver(config);
    default:
      return new OracleAdminDriver(config);
  }
}
