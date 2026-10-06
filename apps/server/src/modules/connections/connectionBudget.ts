import crypto from "node:crypto";
import type { DatabaseConnectionConfig } from "@nebuladb/shared";
import { ApiError } from "../../shared/errors.js";

/**
 * Per-*target-database* rate limiting, on top of the per-IP route limits: one project, or
 * several connections to the same server, must not open connection after connection against
 * somebody's real database.
 *
 * Keyed by a hash of where traffic lands (engine + host + port + database, or the SQLite
 * file), not by connection id. In-memory, per process.
 */

export type BudgetKind = "connect" | "write" | "admin" | "adminWrite";

/** Opening a driver: test, pull, plan. Generous for a person clicking, tight for a loop. */
const CONNECT_LIMIT = { max: 30, windowMs: 60_000 };
/** Executing migration/rollback SQL — changes a real schema; far fewer is plenty. */
const WRITE_LIMIT = { max: 5, windowMs: 60_000 };
/** Admin console reads: browsing a tree fires a request per click, so the ceiling is far higher than `connect`. */
const ADMIN_LIMIT = { max: 240, windowMs: 60_000 };
/** Admin console writes (a write-mode statement, a drop, a grant). An operator works statement by statement, hence more than `write`. */
const ADMIN_WRITE_LIMIT = { max: 40, windowMs: 60_000 };
const LIMITS: Record<BudgetKind, { max: number; windowMs: number }> = {
  connect: CONNECT_LIMIT,
  write: WRITE_LIMIT,
  admin: ADMIN_LIMIT,
  adminWrite: ADMIN_WRITE_LIMIT,
};
const MAX_TRACKED_TARGETS = 5_000;

const hits = new Map<string, number[]>();

export function targetKey(config: DatabaseConnectionConfig): string {
  let target: string;
  if (config.engine === "sqlite") {
    target = `sqlite:${config.filePath ?? ""}`;
  } else if (config.connectionString) {
    try {
      const url = new URL(config.connectionString);
      target = `${config.engine}://${url.hostname.toLowerCase()}:${url.port}${url.pathname}`;
    } catch {
      target = `${config.engine}:${config.connectionString}`;
    }
  } else {
    target = `${config.engine}://${(config.host ?? "").toLowerCase()}:${config.port ?? ""}/${config.database ?? ""}`;
  }
  return crypto.createHash("sha256").update(target).digest("hex");
}

/** Records one use of `kind` against `key`, or throws a 429 if the window is already full. */
export function takeConnectionBudget(key: string, kind: BudgetKind, now = Date.now()): void {
  const limit = LIMITS[kind];
  const bucket = `${kind}:${key}`;
  const recent = (hits.get(bucket) ?? []).filter((at) => now - at < limit.windowMs);
  if (recent.length >= limit.max) {
    hits.set(bucket, recent);
    const retryAfter = Math.ceil((recent[0] + limit.windowMs - now) / 1000);
    throw new ApiError("CONNECTION_RATE_LIMITED", { details: { retryAfterSeconds: retryAfter, kind } });
  }
  recent.push(now);
  hits.delete(bucket); // re-insert last, so Map order approximates least-recently-used
  hits.set(bucket, recent);
  if (hits.size > MAX_TRACKED_TARGETS) hits.delete(hits.keys().next().value!);
}

/** Tests only — every test file shares one process-wide map. */
export function resetConnectionBudgets(): void {
  hits.clear();
}
