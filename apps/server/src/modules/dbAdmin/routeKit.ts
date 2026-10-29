import type { DatabaseConnectionConfig, DbAdminObjectRef, DbAdminStatementsResult } from "@nebuladb/shared";
import type { FastifyRequest } from "fastify";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin } from "../../shared/guards.js";
import type { BudgetKind } from "../connections/connectionBudget.js";
import { connectionOwner, getConnectionById } from "../connections/repository.js";
import { requireDbConsoleUser, type DbConsoleUser } from "../dbAccess/service.js";
import { optionalName } from "./drivers/common.js";
import { createAdminDriver, type AdminStatement, type DatabaseAdminDriver } from "./drivers/index.js";

export /** Reads: listing, browsing, a query. A person clicking through a tree, not a script. */
const READ_LIMIT = { config: { rateLimit: { max: 240, timeWindow: "1 minute" } } };

export /** Anything that changes the instance's connection list or the target server. */
const WRITE_LIMIT = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };

/** A page of a table's rows, as the explorer asks for one. */
const DEFAULT_PAGE = 100;
const MAX_PAGE = 500;

export function clamp(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (value === undefined || value === null || value === "" || !Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), max);
}

export function pageFromQuery(req: FastifyRequest): { limit: number; offset: number } {
  const { limit, offset } = req.query as { limit?: string; offset?: string };
  return { limit: clamp(limit, DEFAULT_PAGE, MAX_PAGE), offset: Math.max(0, Math.trunc(Number(offset) || 0)) };
}

/** What the query route accepts of a statement, and so what a saved query may hold. */
export const MAX_SQL_LENGTH = 200_000;

export async function loadConnection(id: string): Promise<DatabaseConnectionConfig> {
  const connection = await getConnectionById(id);
  if (!connection || (await connectionOwner(id))) throw new ApiError("CONNECTION_NOT_FOUND");
  return connection;
}

/**
 * The two families of console routes: under `/api/admin/connections`, instance
 * administrators only; under `/api/connections`, whoever `requireDbConsoleUser`
 * lets in — administrators, and members an administrator granted the connection to.
 */
export const CONSOLE_ROUTES: [string, (req: FastifyRequest, id: string) => Promise<DbConsoleUser>][] = [
  [
    "/api/admin/connections",
    async (req, id) => ({ user: requireAdmin(req), connection: await loadConnection(id), access: "admin" }),
  ],
  ["/api/connections", requireDbConsoleUser],
];

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
