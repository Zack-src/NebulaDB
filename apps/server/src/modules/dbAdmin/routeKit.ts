import type { DatabaseConnectionConfig, DbAdminObjectRef, DbAdminStatementsResult } from "@nebuladb/shared";
import type { FastifyRequest } from "fastify";
import { ApiError } from "../../shared/errors.js";
import type { BudgetKind } from "../connections/connectionBudget.js";
import { connectionOwner, getConnectionById } from "../connections/repository.js";
import { optionalName } from "./drivers/common.js";
import { createAdminDriver, type AdminStatement, type DatabaseAdminDriver } from "./drivers/index.js";

export /** Reads: listing, browsing, a query. A person clicking through a tree, not a script. */
const READ_LIMIT = { config: { rateLimit: { max: 240, timeWindow: "1 minute" } } };

export /** Anything that changes the instance's connection list or the target server. */
const WRITE_LIMIT = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };

export function loadConnection(id: string): DatabaseConnectionConfig {
  const connection = getConnectionById(id);
  if (!connection || connectionOwner(id)) throw new ApiError("CONNECTION_NOT_FOUND");
  return connection;
}

export /**
 * Opens an administration driver, runs `fn`, always closes. Whatever the
 * target database itself answers is passed through as a 502 with its own
 * message: on these admin-only routes that message *is* the useful part
 * ("permission denied for table x"), where the default handler would hide it
 * behind a generic 500 and file it as a server bug.
 */
async function withDriver<T>(
  connection: DatabaseConnectionConfig,
  kind: BudgetKind,
  fn: (driver: DatabaseAdminDriver) => Promise<T>,
): Promise<T> {
  const driver = await createAdminDriver(connection, kind);
  try {
    return await fn(driver);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("DB_ADMIN_QUERY_FAILED", { message: err instanceof Error ? err.message : String(err) });
  } finally {
    await driver.close().catch(() => {});
  }
}

export function assertWritable(connection: DatabaseConnectionConfig): void {
  if (connection.readOnly) throw new ApiError("CONNECTION_READ_ONLY");
}

export function refFromQuery(req: FastifyRequest): DbAdminObjectRef {
  const query = req.query as Record<string, string | undefined>;
  return {
    database: optionalName(query.database, "database"),
    schema: optionalName(query.schema, "schema"),
    table: optionalName(query.table, "table"),
  };
}

export async function previewOrExecute(
  driver: DatabaseAdminDriver,
  statements: AdminStatement[],
  execute: boolean,
  database: string | undefined,
): Promise<DbAdminStatementsResult> {
  if (execute) await driver.execute(statements, database);
  return { sql: statements.map((s) => s.display), executed: execute };
}
