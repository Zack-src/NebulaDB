import type { DbAdminQueryResult, StructuralAction } from "@nebuladb/shared";
import type { FastifyRequest } from "fastify";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { markOutOfSchema } from "../connections/drift.js";
import type { DbConsoleUser } from "../dbAccess/service.js";
import { optionalName } from "./drivers/common.js";
import { recordQuery } from "./queryHistory.js";
import { MAX_SQL_LENGTH, assertWritable, clamp, withDriver } from "./routeKit.js";
import { assertDataStatement, assertReadOnlyStatement, findStructuralStatements } from "./sqlGuard.js";
import { describeStructuralActions, effectiveStructurePolicy, judgeStructuralActions } from "./structurePolicy.js";

const DEFAULT_MAX_ROWS = 1000;

const MAX_MAX_ROWS = 5000;

const DEFAULT_TIMEOUT_MS = 30_000;

const MAX_TIMEOUT_MS = 120_000;

export interface ConsoleQueryBody {
  sql?: unknown;
  database?: unknown;
  readOnly?: unknown;
  editor?: unknown;
  confirmStructural?: unknown;
  confirmWrite?: unknown;
  maxRows?: unknown;
  timeoutMs?: unknown;
}

export interface ConsoleQueryOptions {
  /** Pins the statement to the connection's own database: `database` in the body is ignored. */
  pinDatabase?: boolean;
}

/**
 * Runs one statement of the SQL console for whoever `access` says, with every guard the console
 * has: read-only unless switched off, a member's (non-administrator's) write confirmed in the
 * request and limited to data statements, structural changes judged against the structure policy,
 * the history and the audit trail. Shared by the console's routes and the public API's
 * (`publicApi/sqlRoutes.ts`), so an AI agent goes through exactly what a person does.
 */
export async function runConsoleQuery(
  req: FastifyRequest,
  connectionId: string,
  { user, connection, access }: DbConsoleUser,
  rawBody: unknown,
  options: ConsoleQueryOptions = {},
): Promise<{ result: DbAdminQueryResult }> {
  const id = connectionId;
  const member = access !== "admin";
  const body = (rawBody ?? {}) as ConsoleQueryBody;
  if (typeof body.sql !== "string" || !body.sql.trim() || body.sql.length > MAX_SQL_LENGTH) {
    throw new ApiError("DB_ADMIN_INPUT_INVALID", { message: "sql is required" });
  }
  const sql = body.sql;
  // Read-only unless explicitly switched off — a missing flag must never mean "write".
  const readOnly = body.editor === true || body.readOnly !== false;
  const database =
    body.editor === true || options.pinDatabase ? connection.database : optionalName(body.database, "database");
  if (!readOnly && access === "read") throw new ApiError("DB_ACCESS_WRITE_FORBIDDEN");
  if (!readOnly) assertWritable(connection);
  // A member's write is confirmed in the request itself, not only by a dialog the client may skip.
  if (!readOnly && member && body.confirmWrite !== true) {
    throw new ApiError("DB_ACCESS_WRITE_CONFIRMATION_REQUIRED");
  }

  // Read-only mode already refuses any DDL, so only a write can be structural.
  // Judged before anything runs: a refusal must leave the database untouched.
  // Found whatever the policy says: a structural change made under `free`, or
  // typed where the policy does not cover SQL, still leaves the schema behind
  // and the projects modelling this database are told so. (A member never
  // gets this far with one: `assertDataStatement` below refuses structure.)
  let structural: StructuralAction[] = [];
  let outOfSchema = false;
  let leavesSchemaBehind = false;
  if (!readOnly && !member) {
    const policy = await effectiveStructurePolicy(id);
    structural = findStructuralStatements(sql, connection.engine);
    outOfSchema =
      judgeStructuralActions(policy, policy.applyToSql ? structural : [], body.confirmStructural === true) ===
      "out-of-schema";
    leavesSchemaBehind = structural.length > 0 && policy.projects.length > 0;
  }

  const startedAt = Date.now();
  const record = async (success: boolean, rowCount: number | null, error: string | null) => {
    const durationMs = Date.now() - startedAt;
    await recordQuery({
      connectionId: id,
      userId: user.id,
      database: database ?? null,
      sql,
      readOnly,
      success,
      rowCount,
      durationMs,
      error,
    });
    // The statement text, never its result: rows can hold anything.
    await auditUser(
      user,
      member ? "dbaccess.query" : "dbadmin.query",
      { type: "connection", id },
      `${member ? `[${access} access] ` : ""}${readOnly ? "read" : "WRITE"} ${success ? `ok ${rowCount ?? 0} row(s)` : "failed"} ${durationMs}ms: ${sql.replace(/\s+/g, " ").trim()}`,
      req,
    );
  };

  try {
    // Checked here rather than left to the drivers so that a member's refused
    // statement is in the history and the audit trail like any other attempt.
    if (member) {
      if (readOnly) assertReadOnlyStatement(sql, connection.engine);
      else assertDataStatement(sql, connection.engine);
    }
    const result = await withDriver(connection, readOnly ? "admin" : "adminWrite", (driver) =>
      driver.runQuery(sql, {
        database,
        readOnly,
        singleStatement: member && !readOnly,
        // Members get the default ceilings, which are also their maximum.
        maxRows: clamp(body.maxRows, DEFAULT_MAX_ROWS, member ? DEFAULT_MAX_ROWS : MAX_MAX_ROWS),
        timeoutMs: clamp(body.timeoutMs, DEFAULT_TIMEOUT_MS, member ? DEFAULT_TIMEOUT_MS : MAX_TIMEOUT_MS),
      }),
    );
    await record(true, result.rowCount, null);
    if (leavesSchemaBehind) await markOutOfSchema(id, `sql: ${describeStructuralActions(structural)}`);
    if (outOfSchema) {
      await auditUser(
        user,
        "dbadmin.structure.out_of_schema",
        { type: "connection", id },
        `sql: ${describeStructuralActions(structural)}`,
        req,
      );
    }
    return { result };
  } catch (err) {
    await record(false, null, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
