import type { DbHealthBoard } from "@nebuladb/shared";
import { asUnattended } from "../../infrastructure/actor.js";
import { db } from "../../infrastructure/db.js";
import { getConnectionById } from "../connections/repository.js";
import { createAdminDriver, type DatabaseAdminDriver } from "../dbAdmin/drivers/index.js";
import { checkConnectionHealth } from "../dbAdmin/health.js";

/** What reads the server; an object so a test can replace the one step that needs a live server. */
export const healthReader = {
  async read(connectionId: string): Promise<Pick<DbHealthBoard, "databases" | "sessions" | "blocking">> {
    const connection = getConnectionById(connectionId);
    const empty = { databases: null, sessions: null, blocking: null };
    if (!connection) return empty;
    return asUnattended(async () => {
      let driver: DatabaseAdminDriver;
      try {
        driver = await createAdminDriver(connection, "admin");
      } catch {
        return empty;
      }
      // Each part on its own: an account that may not read one still gets the others.
      const attempt = async <T>(work: () => Promise<T>): Promise<T | null> => {
        try {
          return await work();
        } catch {
          return null;
        }
      };
      try {
        const databases = await attempt(async () =>
          (await driver.listDatabases()).map((d) => ({ name: d.name, sizeBytes: d.sizeBytes, system: d.system })),
        );
        const sessions = driver.capabilities.sessions
          ? await attempt(async () => {
              const list = await driver.listSessions();
              const longest = list
                .filter((s) => s.durationSeconds !== null)
                .sort((a, b) => (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0))[0];
              const idle = list.filter((s) => /idle|sleep/i.test(s.state ?? "")).length;
              return {
                total: list.length,
                idle,
                active: list.length - idle,
                longestSeconds: longest?.durationSeconds ?? null,
                longestUser: longest?.user ?? null,
              };
            })
          : null;
        const blocking = driver.capabilities.sessions ? await attempt(() => driver.listBlocking()) : null;
        return { databases, sessions, blocking };
      } finally {
        await driver.close().catch(() => {});
      }
    });
  },
};

/** A fresh probe (which also adds a point to the latency series), then what the server says about itself. */
export async function buildHealthBoard(connectionId: string): Promise<DbHealthBoard | null> {
  const summary = await checkConnectionHealth(connectionId);
  if (!summary) return null;
  const history = (
    db
      .prepare(
        "SELECT at, ok, latency_ms FROM db_health_samples WHERE connection_id = ? ORDER BY at DESC, rowid DESC LIMIT 200",
      )
      .all(connectionId) as { at: string; ok: number; latency_ms: number }[]
  )
    .reverse()
    .map((row) => ({ at: row.at, ok: row.ok === 1, latencyMs: row.latency_ms }));
  const online = summary.health.status === "online";
  const parts = online ? await healthReader.read(connectionId) : { databases: null, sessions: null, blocking: null };
  return {
    status: {
      ok: online,
      version: summary.health.version,
      latencyMs: summary.health.latencyMs,
      checkedAt: summary.health.checkedAt,
      error: summary.health.error,
    },
    history,
    ...parts,
  };
}
