import { schemaForConnection } from "../environments/variables.js";
import { readProjectFromDoc, type DriftCheckResult, type Project, type ProjectDriftEntry } from "@nebuladb/shared";
import {
  FINGERPRINT_VERSION,
  diffFingerprints,
  diffTargetAgainstLive,
  fingerprintSchema,
  type SchemaFingerprint,
} from "@nebuladb/dbml-engine";
import { db } from "../../infrastructure/db.js";
import { getRoom, notifyProject } from "../../realtime/roomRegistry.js";
import { ApiError } from "../../shared/errors.js";
import { createDatabaseDriver } from "./drivers/index.js";
import { getProjectConnection } from "./repository.js";
import { closeDriftEvents } from "../monitoring/repository.js";

/**
 * Tracks whether a project's database still is what the project last knew it to be, per
 * (project, connection):
 *
 * - a **reference fingerprint**: the database structure right after the last deployment or pull;
 * - an **out-of-schema mark**: set when a structural change was made from the console, which
 *   shows the editor banner without opening any connection.
 *
 * Changes made by other tools are detected against the same reference (`modules/monitoring/`).
 */

export type FingerprintSource = "deploy" | "rollback" | "pull";

/** The live schema is now the agreed state: remember it, and clear any out-of-schema mark. */
export async function saveReferenceFingerprint(
  projectId: string,
  connectionId: string,
  live: Pick<Project, "tables" | "refs">,
  source: FingerprintSource,
): Promise<void> {
  const fingerprint = fingerprintSchema(live);
  await db.transaction(async () => {
    await db
      .prepare(
        `INSERT INTO schema_fingerprints (project_id, connection_id, source, hash, snapshot_json)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (project_id, connection_id) DO UPDATE SET
         source = excluded.source, hash = excluded.hash, snapshot_json = excluded.snapshot_json,
         taken_at = utc_now()`,
      )
      .run(projectId, connectionId, source, fingerprint.hash, JSON.stringify(fingerprint));
    await db
      .prepare(
        `UPDATE project_connection_links SET out_of_schema_at = NULL, out_of_schema_detail = NULL
        WHERE project_id = ? AND connection_id = ?`,
      )
      .run(projectId, connectionId);
    // Schema and database agree again: what the watch had found is settled.
    await closeDriftEvents(projectId, connectionId, "resolved", ["external", "partial-deployment"]);
  });
  notifyProject(projectId, { type: "drift-changed" });
}

export async function loadReference(projectId: string, connectionId: string): Promise<SchemaFingerprint | null> {
  const row = (await db
    .prepare("SELECT snapshot_json FROM schema_fingerprints WHERE project_id = ? AND connection_id = ?")
    .get(projectId, connectionId)) as { snapshot_json: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.snapshot_json) as SchemaFingerprint;
    // A reference taken by an older canonical form says nothing comparable.
    return parsed.version === FINGERPRINT_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

/** When the reference was taken — `null` when there is none. */
export async function referenceTakenAt(projectId: string, connectionId: string): Promise<string | null> {
  const row = (await db
    .prepare("SELECT taken_at FROM schema_fingerprints WHERE project_id = ? AND connection_id = ?")
    .get(projectId, connectionId)) as { taken_at: string } | undefined;
  return row?.taken_at ?? null;
}

/** Marks one project's link to a database as changed outside the schema, with what was found. */
export async function markProjectOutOfSchema(projectId: string, connectionId: string, detail: string): Promise<void> {
  await db
    .prepare(
      `UPDATE project_connection_links SET out_of_schema_at = utc_now(), out_of_schema_detail = ?
      WHERE project_id = ? AND connection_id = ?`,
    )
    .run(detail.slice(0, 500), projectId, connectionId);
  notifyProject(projectId, { type: "drift-changed" });
}

/**
 * A structural change was just made to this database outside the schema. Every
 * project modelling it is marked, and told at once if it is open somewhere.
 */
export async function markOutOfSchema(connectionId: string, detail: string): Promise<void> {
  const projects = (await db
    .prepare("SELECT project_id FROM project_connection_links WHERE connection_id = ?")
    .all(connectionId)) as { project_id: string }[];
  if (projects.length === 0) return;
  await db
    .prepare(
      `UPDATE project_connection_links SET out_of_schema_at = utc_now(), out_of_schema_detail = ?
      WHERE connection_id = ?`,
    )
    .run(detail.slice(0, 500), connectionId);
  for (const { project_id } of projects) notifyProject(project_id, { type: "drift-changed" });
}

export async function dismissOutOfSchema(projectId: string, connectionId: string): Promise<boolean> {
  const changed = (
    await db
      .prepare(
        `UPDATE project_connection_links SET out_of_schema_at = NULL, out_of_schema_detail = NULL
        WHERE project_id = ? AND connection_id = ? AND out_of_schema_at IS NOT NULL`,
      )
      .run(projectId, connectionId)
  ).changes;
  // Waved off: the watch will not report this state of the database again.
  await closeDriftEvents(projectId, connectionId, "ignored", ["external", "partial-deployment"]);
  if (changed > 0) notifyProject(projectId, { type: "drift-changed" });
  return changed > 0;
}

/** What the editor needs to decide whether to show a banner. No database is contacted. */
export async function listProjectDrift(projectId: string): Promise<ProjectDriftEntry[]> {
  const rows = (await db
    .prepare(
      `SELECT c.id AS id, c.name AS name, l.out_of_schema_at AS at, l.out_of_schema_detail AS detail,
              f.taken_at AS reference_at
         FROM project_connection_links l
         JOIN db_connections c ON c.id = l.connection_id
         LEFT JOIN schema_fingerprints f ON f.project_id = l.project_id AND f.connection_id = l.connection_id
        WHERE l.project_id = ?
        ORDER BY LOWER(c.name)`,
    )
    .all(projectId)) as {
    id: string;
    name: string;
    at: string | null;
    detail: string | null;
    reference_at: string | null;
  }[];
  return rows.map((row) => ({
    connectionId: row.id,
    connectionName: row.name,
    outOfSchemaAt: row.at,
    outOfSchemaDetail: row.detail,
    referenceTakenAt: row.reference_at,
  }));
}

/**
 * Reads the database now and says how it differs — from the schema in the
 * editor (the number the banner shows, by the same lenient comparison as the
 * deployment plan, so the two never disagree) and from the reference (what
 * changed since Nebula last touched it, by the strict fingerprint).
 */
export async function checkDrift(
  projectId: string,
  projectName: string,
  connectionId: string,
): Promise<DriftCheckResult> {
  const conn = await getProjectConnection(projectId, connectionId);
  if (!conn) throw new ApiError("CONNECTION_NOT_FOUND");
  const driver = await createDatabaseDriver(conn);
  try {
    const live = await driver.introspectSchema();
    const canvas = await schemaForConnection(
      readProjectFromDoc((await getRoom(projectId)).doc, projectId, projectName),
      conn,
    );
    const diff = diffTargetAgainstLive(live, canvas);
    const reference = await loadReference(projectId, connectionId);
    const since = reference ? diffFingerprints(reference, fingerprintSchema(live)) : null;
    return {
      checkedAt: new Date().toISOString(),
      againstSchema: { tables: diff.tables.length, refs: diff.refs.length },
      sinceReference: since ? { added: since.added, removed: since.removed, changed: since.changed } : null,
    };
  } finally {
    await driver.close().catch(() => {});
  }
}
