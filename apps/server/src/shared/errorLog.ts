import { randomUUID } from "node:crypto";
import { db } from "../infrastructure/db.js";

/**
 * Aggregated unexpected errors — server-side unhandled throws and Fastify
 * 500s, plus client-side render crashes `ErrorBoundary` reports — in one
 * place an operator can actually look at. Before this, `uncaughtException`
 * was logged and survived (see `index.ts`) but nothing *aggregated* it
 * anywhere, and the client side reported nothing at all: a real incident was
 * knowable only by reading process logs live or grepping them after the
 * fact.
 *
 * Deliberately not a compliance trail like `audit.ts` — it's a debugging
 * aid, so it's capped by row count (see `recordError`'s trim) rather than
 * dated retention, and needs no new configuration to work.
 */

export type ErrorSource = "server" | "client";

export interface ErrorLogEntry {
  id: string;
  createdAt: string;
  source: ErrorSource;
  message: string;
  stack: string | null;
  context: string | null;
  userId: string | null;
  userEmail: string | null;
}

interface ErrorLogRow {
  id: string;
  created_at: string;
  source: string;
  message: string;
  stack: string | null;
  context: string | null;
  user_id: string | null;
  user_email: string | null;
}

/** Row cap, trimmed on every write — see the module comment for why this is count-based, not date-based. */
const MAX_ROWS = 2000;
/** A stack trace can run to hundreds of lines for a deeply nested call; cap so one error can't dominate the table's storage. */
const MAX_STACK_LENGTH = 8000;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_CONTEXT_LENGTH = 500;

/**
 * Records one error. Never throws — same rule as `audit()`: a failed write
 * here must not turn a successful (or already-failing) request into a worse
 * one, and must never mask the original error from its own caller/logger.
 */
export function recordError(
  source: ErrorSource,
  message: string,
  options: {
    stack?: string | null;
    context?: string | null;
    user?: { id: string; email: string } | null;
  } = {},
): void {
  try {
    db.prepare(
      `INSERT INTO error_log (id, source, message, stack, context, user_id, user_email)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      source,
      message.slice(0, MAX_MESSAGE_LENGTH),
      options.stack ? options.stack.slice(0, MAX_STACK_LENGTH) : null,
      options.context ? options.context.slice(0, MAX_CONTEXT_LENGTH) : null,
      options.user?.id ?? null,
      options.user?.email ?? null,
    );
    // Cheap with the `created_at` index and a rare write path (real errors,
    // not every request) — no reason to defer this to a scheduled sweep.
    db.prepare(
      `DELETE FROM error_log WHERE id NOT IN (SELECT id FROM error_log ORDER BY created_at DESC, rowid DESC LIMIT ?)`,
    ).run(MAX_ROWS);
  } catch (err) {
    console.error("[errorLog] failed to record error:", err);
  }
}

export interface ErrorLogQuery {
  limit?: number;
  before?: string;
  source?: ErrorSource;
}

/** Newest first. Read-only, admin-only at the route layer — see `modules/errors/routes.ts`. */
export function listErrorLog(query: ErrorLogQuery = {}): ErrorLogEntry[] {
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (query.before) {
    conditions.push("created_at < ?");
    params.push(query.before);
  }
  if (query.source) {
    conditions.push("source = ?");
    params.push(query.source);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT id, created_at, source, message, stack, context, user_id, user_email
       FROM error_log ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(...params, limit) as ErrorLogRow[];
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    source: row.source as ErrorSource,
    message: row.message,
    stack: row.stack,
    context: row.context,
    userId: row.user_id,
    userEmail: row.user_email,
  }));
}

/** Counts recorded since the process started, by source — cheap in-memory tally for `/api/metrics`, not a query against the table. */
const sessionCounts: Record<ErrorSource, number> = { server: 0, client: 0 };
export function tallyErrorForMetrics(source: ErrorSource): void {
  sessionCounts[source]++;
}
export function getErrorCountsSinceBoot(): Record<ErrorSource, number> {
  return { ...sessionCounts };
}
