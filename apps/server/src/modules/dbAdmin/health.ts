import type { AdminConnectionSummary } from "@nebuladb/shared";
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
export async function checkConnectionHealth(id: string): Promise<AdminConnectionSummary | null> {
  if (await connectionOwner(id)) return Promise.resolve(null);
  const connection = await getConnectionById(id);
  return connection?.authMode === "personal" && !connection.user
    ? probeConnection(id)
    : asUnattended(() => probeConnection(id));
}

async function probeConnection(id: string): Promise<AdminConnectionSummary | null> {
  const config = await getConnectionById(id);
  if (!config) return null;
  const startedAt = Date.now();
  try {
    const driver = await createDatabaseDriver(config);
    try {
      const result = await driver.testConnection();
      await recordConnectionHealth(id, {
        ok: result.ok,
        version: result.version,
        error: result.error,
        latencyMs: Date.now() - startedAt,
      });
    } finally {
      await driver.close().catch(() => {});
    }
  } catch (err) {
    await recordConnectionHealth(id, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - startedAt,
    });
  }
  return await getAdminConnection(id);
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
  const pass = async () => {
    if (running) return;
    running = true;
    try {
      for (const connection of await listAllConnections()) {
        if (connection.authMode === "personal" && !connection.user) continue;
        await checkConnectionHealth(connection.id);
      }
    } catch (err) {
      console.error("[dbAdmin] health check pass failed:", err);
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => void pass(), intervalMinutes * 60_000);
  timer.unref();
}
