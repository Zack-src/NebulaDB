import { notifyFollowers } from "../notifications/repository.js";
import { diffFingerprints, fingerprintSchema } from "@athanordb/dbml-engine";
import { db } from "../../infrastructure/db.js";
import { notifyProject } from "../../realtime/roomRegistry.js";
import { createDatabaseDriver } from "../connections/drivers/index.js";
import { loadReference, markProjectOutOfSchema, referenceTakenAt } from "../connections/drift.js";
import { getProjectConnection } from "../connections/repository.js";
import { emitWebhookEvent } from "../webhooks/dispatcher.js";
import {
  alreadyReported,
  closeDriftEvents,
  getMonitorSettings,
  hasOpenUnreachable,
  insertDriftEvent,
  listDueProjects,
  markChecked,
} from "./repository.js";

/** One database read must not hold the watch up longer than this. */
const READ_TIMEOUT_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer within ${ms / 1000} s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** The project's databases that have a reference — a deployment or a pull happened, so there is something to compare with. */
function watchedConnections(projectId: string): string[] {
  return (
    db
      .prepare(
        `SELECT l.connection_id FROM project_connection_links l
           JOIN schema_fingerprints f ON f.project_id = l.project_id AND f.connection_id = l.connection_id
          WHERE l.project_id = ?`,
      )
      .all(projectId) as { connection_id: string }[]
  ).map((row) => row.connection_id);
}

/** A deployment that failed after running some statements since the reference: it explains a change. */
function partialDeploymentSince(projectId: string, connectionId: string, since: string): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM deployment_history
          WHERE project_id = ? AND connection_id = ? AND success = 0 AND executed_statements > 0 AND created_at >= ?
          LIMIT 1`,
      )
      .get(projectId, connectionId, since) !== undefined
  );
}

export interface MonitorCheckResult {
  checked: number;
  changes: number;
  unreachable: number;
}

/**
 * Reads each watched database of a project and compares its structure with
 * the reference — the fingerprint taken at the last deployment or pull, the
 * last moment Athanor knew the two agreed.
 *
 * A difference no successful deployment explains is a change made outside
 * Athanor: it is recorded once per state of the database (the same change is
 * not reported at every pass, nor after someone waved it off), the project's
 * link is marked so the editor shows its banner, and `drift.detected` goes to
 * the project's webhooks. A database that cannot be read is "unreachable" —
 * reported once, closed when it answers again, never taken for a change.
 */
export async function checkProjectMonitoring(projectId: string): Promise<MonitorCheckResult> {
  const settings = getMonitorSettings(projectId);
  const ignored = new Set(settings.ignoreTables.map((name) => name.toLowerCase()));
  const result: MonitorCheckResult = { checked: 0, changes: 0, unreachable: 0 };
  for (const connectionId of watchedConnections(projectId)) {
    const conn = getProjectConnection(projectId, connectionId);
    const reference = loadReference(projectId, connectionId);
    const takenAt = referenceTakenAt(projectId, connectionId);
    if (!conn || !reference || !takenAt) continue;
    result.checked++;

    let live;
    try {
      const driver = await createDatabaseDriver(conn);
      try {
        live = await withTimeout(driver.introspectSchema(), READ_TIMEOUT_MS);
      } finally {
        await driver.close().catch(() => {});
      }
    } catch (err) {
      result.unreachable++;
      if (!hasOpenUnreachable(projectId, connectionId)) {
        insertDriftEvent({
          projectId,
          connectionId,
          kind: "unreachable",
          error: err instanceof Error ? err.message : String(err),
        });
      }
      continue;
    }
    closeDriftEvents(projectId, connectionId, "resolved", ["unreachable"]);

    const fingerprint = fingerprintSchema(live);
    const diff = diffFingerprints(reference, fingerprint);
    const keep = (name: string) =>
      !ignored.has(name.toLowerCase()) && !ignored.has(name.toLowerCase().split(".").pop()!);
    const added = diff.added.filter(keep);
    const removed = diff.removed.filter(keep);
    const changed = diff.changed.filter(keep);
    if (added.length + removed.length + changed.length === 0) {
      // Back to the reference (someone undid it by hand): nothing open any more.
      closeDriftEvents(projectId, connectionId, "resolved", ["external", "partial-deployment"]);
      continue;
    }
    if (alreadyReported(projectId, connectionId, fingerprint.hash)) continue;

    const kind = partialDeploymentSince(projectId, connectionId, takenAt) ? "partial-deployment" : "external";
    insertDriftEvent({ projectId, connectionId, kind, liveHash: fingerprint.hash, added, removed, changed });
    result.changes++;
    const summary = [
      added.length ? `+${added.join(", +")}` : null,
      removed.length ? `-${removed.join(", -")}` : null,
      changed.length ? `~${changed.join(", ~")}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    markProjectOutOfSchema(
      projectId,
      connectionId,
      `${kind === "external" ? "external change" : "partial deployment"}: ${summary}`,
    );
    notifyFollowers(projectId, "drift", {
      kind,
      connection: conn.name,
      environment: conn.environment ?? null,
      tables: added.length + removed.length + changed.length,
    });
    emitWebhookEvent(projectId, "drift.detected", {
      kind,
      connectionName: conn.name,
      environment: conn.environment ?? null,
      added,
      removed,
      changed,
    });
  }
  markChecked(projectId);
  if (result.checked > 0) notifyProject(projectId, { type: "drift-changed" });
  return result;
}

/** One pass of the scheduled watch: every project that is due, one after the other — never a burst of connections. */
export async function runDueMonitoring(): Promise<void> {
  for (const projectId of listDueProjects()) {
    try {
      await checkProjectMonitoring(projectId);
    } catch (err) {
      console.error(`[monitoring] check of project ${projectId} failed:`, err);
      markChecked(projectId);
    }
  }
}
