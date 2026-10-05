import type { AdminConnectionSummary } from "@athanordb/shared";
import { asUnattended } from "../../infrastructure/actor.js";
import { createDatabaseDriver } from "../connections/drivers/index.js";
import {
  getAdminConnection,
  connectionOwner,
  getConnectionById,
  listAllConnections,
  recordConnectionHealth,
} from "../connections/repository.js";

/**
 * One connectivity probe — the same `testConnection` the form's "Test" button
 * runs — timed and stored on the connection, so the admin list can show
 * whether each server answered the last time anyone asked. Never throws: an
 * unreachable database is a result, not an error.
 *
 * Always as the connection's service account, whoever asked: the stored status
 * says whether the database answers, and must not read "offline" because the
 * administrator who clicked has no personal account on it.
 */
export function checkConnectionHealth(id: string): Promise<AdminConnectionSummary | null> {
  if (connectionOwner(id)) return Promise.resolve(null);
  const connection = getConnectionById(id);
  return connection?.authMode === "personal" && !connection.user
    ? probeConnection(id)
    : asUnattended(() => probeConnection(id));
}

async function probeConnection(id: string): Promise<AdminConnectionSummary | null> {
  const config = getConnectionById(id);
  if (!config) return null;
  const startedAt = Date.now();
  try {
    const driver = await createDatabaseDriver(config);
    try {
      const result = await driver.testConnection();
      recordConnectionHealth(id, {
        ok: result.ok,
        version: result.version,
        error: result.error,
        latencyMs: Date.now() - startedAt,
      });
    } finally {
      await driver.close().catch(() => {});
    }
  } catch (err) {
    recordConnectionHealth(id, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - startedAt,
    });
  }
  return getAdminConnection(id);
}

let timer: NodeJS.Timeout | null = null;

/**
 * Background refresh of every connection's status. One at a time, on purpose:
 * this is a courtesy indicator, and it must never look like a burst of
 * connections to somebody's production server.
 */
export function startConnectionHealthChecks(intervalMinutes: number): void {
  if (intervalMinutes <= 0 || timer) return;
  let running = false;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      for (const connection of listAllConnections()) {
        if (connection.authMode === "personal" && !connection.user) continue;
        await checkConnectionHealth(connection.id);
      }
    } catch (err) {
      console.error("[dbAdmin] health check pass failed:", err);
    } finally {
      running = false;
    }
  }, intervalMinutes * 60_000);
  timer.unref();
}

export function stopConnectionHealthChecks(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
