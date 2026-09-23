import crypto from "node:crypto";
import type { DatabaseConnectionConfig } from "@athanordb/shared";
import { ApiError } from "../../shared/errors.js";

/**
 * Per-*target-database* rate limiting (Phase 27 residual gap). The per-IP
 * route limits don't cover this: the session UI's connection routes had
 * none, `/api/v1` counts per caller, and nothing stopped one project — or
 * several connections pointing at the same server — from opening connection
 * after connection against somebody's real database through this app.
 *
 * Keyed by where the traffic actually lands (engine + host + port + database,
 * or the SQLite file), not by connection id, so the ad-hoc "test connection"
 * route and two saved connections to the same server share one budget. The
 * key is a hash: a connection string can carry a password, and a rate-limit
 * table is no place to keep one.
 *
 * In-memory and per process, like the rest of the app's rate limiting — a
 * single-instance deployment is the supported topology (docker-compose).
 */

export type BudgetKind = "connect" | "write";

/** Opening a driver: test, pull, plan. Generous for a person clicking, tight for a loop. */
const CONNECT_LIMIT = { max: 30, windowMs: 60_000 };
/** Executing migration/rollback SQL — changes a real schema; far fewer is plenty. */
const WRITE_LIMIT = { max: 5, windowMs: 60_000 };
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
  const limit = kind === "write" ? WRITE_LIMIT : CONNECT_LIMIT;
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
