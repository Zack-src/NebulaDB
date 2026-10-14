import type { DbAdminObjectRef, DbEditableRows, DbRowEditResult } from "@nebuladb/shared";
import type { FastifyInstance } from "fastify";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { optionalName, requireName } from "./drivers/common.js";
import { recordQueryStat } from "./queryStats.js";
import {
  CONSOLE_ROUTES,
  READ_LIMIT,
  WRITE_LIMIT,
  assertWritable,
  pageFromQuery,
  refFromQuery,
  withDriver,
} from "./routeKit.js";
import {
  countRowEdits,
  describeRowEditing,
  planRowEdits,
  readEditablePage,
  runRowEdits,
  type RowStatement,
  type RowStatementOutcome,
} from "./rowEdits.js";

/** A batch waits this long at most on the database, a lock held by someone else included. */
const TIMEOUT_MS = 30_000;

/**
 * Row editing from the explorer's grid, on both families of console routes:
 * the rights are those of a write-mode statement of the SQL console —
 * instance administrators, and members granted `write`, who confirm each
 * batch (`confirmWrite`); never on a read-only connection. On a
 * personal-account connection the driver is opened as the caller.
 *
 * The client sends operations, never SQL: `rowEdits.ts` builds every statement.
 */
export function registerRowEditRoutes(app: FastifyInstance): void {
  for (const [prefix, guard] of CONSOLE_ROUTES) {
    // A page of a table for the grid, with what may be edited of it. Where
    // nothing may, the rows are those of `/rows`: the explorer asks only here.
    app.get(`${prefix}/:id/editable-rows`, READ_LIMIT, async (req): Promise<DbEditableRows> => {
      const { id } = req.params as { id: string };
      const { connection, access } = guard(req, id);
      const ref = refFromQuery(req);
      requireName(ref.table, "table");
      const page = pageFromQuery(req);
      return withDriver(connection, "admin", async (driver) => {
        const editing = describeRowEditing(connection.engine, await driver.describeTable(ref), {
          supported: Boolean(driver.rowSession),
          access,
          readOnly: Boolean(connection.readOnly),
        });
        if (!editing.editable || !driver.rowSession) {
          return { editing, result: await driver.browseRows(ref, page), partial: [], ...page };
        }
        const read = await driver.rowSession({ database: ref.database, write: false, timeoutMs: TIMEOUT_MS }, (run) =>
          readEditablePage(run, connection.engine, ref, editing, page),
        );
        return { editing, ...read, ...page };
      });
    });

    // `execute: false` is the dry run: the same plan, shown instead of run.
    app.post(`${prefix}/:id/row-edits`, WRITE_LIMIT, async (req): Promise<DbRowEditResult> => {
      const { id } = req.params as { id: string };
      const { user, connection, access } = guard(req, id);
      const member = access !== "admin";
      const body = (req.body ?? {}) as {
        database?: unknown;
        schema?: unknown;
        table?: unknown;
        operations?: unknown;
        execute?: unknown;
        confirmWrite?: unknown;
      };
      const execute = body.execute === true;
      if (access === "read") throw new ApiError("DB_ACCESS_WRITE_FORBIDDEN");
      assertWritable(connection);
      // As for a statement of the SQL console: a member's write is confirmed in the request itself.
      if (execute && member && body.confirmWrite !== true) {
        throw new ApiError("DB_ACCESS_WRITE_CONFIRMATION_REQUIRED");
      }
      const ref: DbAdminObjectRef = {
        database: optionalName(body.database, "database"),
        schema: optionalName(body.schema, "schema"),
        table: requireName(body.table, "table"),
      };

      const startedAt = Date.now();
      let statements: RowStatement[] = [];
      const outcomes: RowStatementOutcome[] = [];
      const record = (error: string | null) => {
        const durationMs = Date.now() - startedAt;
        // The journal's statement figures count each statement that ran, by its shape (values masked).
        for (const outcome of outcomes) {
          recordQueryStat({
            connectionId: id,
            userId: user.id,
            sql: outcome.statement.display,
            success: outcome.success,
            rowCount: outcome.success ? 1 : null,
            durationMs: outcome.durationMs,
          });
        }
        // One entry for the batch, statements as shown — like a statement of the SQL console, values included.
        const counts = countRowEdits(statements);
        const target = [ref.database, ref.schema, ref.table].filter(Boolean).join(".");
        auditUser(
          user,
          member ? "dbaccess.rows" : "dbadmin.rows",
          { type: "connection", id },
          `${member ? `[${access} access] ` : ""}WRITE ${error === null ? "ok" : "failed, nothing applied"} on ${target}: ` +
            `${counts.insert} insert, ${counts.update} update, ${counts.delete} delete ${durationMs}ms` +
            `${error === null ? "" : ` — ${error}`}: ${statements.map((s) => s.display.replace(/\s+/g, " ")).join("; ")}`,
          req,
        );
      };

      try {
        const result = await withDriver(connection, execute ? "adminWrite" : "admin", async (driver) => {
          const editing = describeRowEditing(connection.engine, await driver.describeTable(ref), {
            supported: Boolean(driver.rowSession),
            access,
            readOnly: false,
          });
          if (!editing.editable || !driver.rowSession) {
            throw new ApiError("ROW_EDIT_NOT_EDITABLE", { details: { reason: editing.reason } });
          }
          statements = planRowEdits(connection.engine, ref, editing, body.operations);
          if (execute) {
            await driver.rowSession({ database: ref.database, write: true, timeoutMs: TIMEOUT_MS }, (run) =>
              runRowEdits(run, statements, outcomes),
            );
          }
          return { sql: statements.map((s) => s.display), executed: execute, counts: countRowEdits(statements) };
        });
        if (execute) record(null);
        return result;
      } catch (err) {
        // A refused attempt is in the trail like any other; a dry run changes nothing and leaves none.
        if (execute) record(err instanceof Error ? err.message : String(err));
        throw err;
      }
    });
  }
}
