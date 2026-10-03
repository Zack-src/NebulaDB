import type { HistoryMarker } from "@athanordb/shared";
import { db } from "../../infrastructure/db.js";

/** Newest markers kept per kind of source — the timeline is for recent history, the audit log has the rest. */
const MARKER_LIMIT = 200;

/** What `project.revision.restore` writes as its audit detail — parsed back into the marker. */
export function restoreAuditDetail(
  revisionId: string,
  /** The revision the restore wrote, `null` when nothing differed. */
  producedRevisionId: string | null,
  tableNames?: readonly string[],
): string {
  const head = producedRevisionId ? `revision ${revisionId} -> ${producedRevisionId}` : `revision ${revisionId}`;
  if (!tableNames || tableNames.length === 0) return head;
  const listed = tableNames.slice(0, AUDITED_TABLE_NAMES).join(", ");
  const more = tableNames.length > AUDITED_TABLE_NAMES ? ` +${tableNames.length - AUDITED_TABLE_NAMES}` : "";
  return `${head} (tables: ${listed}${more})`;
}

/** Table names written out in a partial restore's audit line; the rest are counted. */
const AUDITED_TABLE_NAMES = 20;

const RESTORE_DETAIL = /^revision (\S+)(?: -> (\S+))?(?: \(tables: (.*)\))?$/;

interface AuditRow {
  action: string;
  created_at: string;
  detail: string | null;
  actor: string | null;
}

/**
 * Events that belong on a project's history timeline without being revisions
 * of their own: locks placed or lifted, restores (whole or partial), and — for
 * project administrators only, the one role that may read deployment history —
 * deployments and their rollbacks. Oldest first, like the revision list.
 *
 * Read from the records that already exist (audit log, deployment history),
 * so nothing new is stored and a marker cannot disagree with them. The audit
 * log's retention therefore bounds how far back lock and restore markers go.
 */
export function listHistoryMarkers(projectId: string, includeDeployments: boolean): HistoryMarker[] {
  const auditRows = db
    .prepare(
      `SELECT a.action, a.created_at, a.detail, COALESCE(u.display_name, a.actor_email) AS actor
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.target_type = 'project' AND a.target_id = ?
          AND a.action IN ('table.lock', 'table.unlock', 'project.revision.restore')
        ORDER BY a.created_at DESC, a.rowid DESC LIMIT ?`,
    )
    .all(projectId, MARKER_LIMIT) as AuditRow[];

  const markers: HistoryMarker[] = auditRows.map((row) => {
    if (row.action === "project.revision.restore") {
      const match = RESTORE_DETAIL.exec(row.detail ?? "");
      const revisionAt = match
        ? ((
            db.prepare("SELECT created_at FROM revisions WHERE id = ? AND project_id = ?").get(match[1], projectId) as
              { created_at: string } | undefined
          )?.created_at ?? null)
        : null;
      return {
        kind: "restore",
        at: row.created_at,
        actor: row.actor,
        detail: match?.[3] ?? "",
        revisionAt,
        ...(match?.[2] ? { producedRevisionId: match[2] } : {}),
      };
    }
    return {
      kind: row.action === "table.lock" ? "lock" : "unlock",
      at: row.created_at,
      actor: row.actor,
      detail: row.detail ?? "",
    };
  });

  if (includeDeployments) {
    const deployments = db
      .prepare(
        `SELECT d.created_at, d.connection_name, d.environment, d.success, d.rollback_of,
                COALESCE(u.display_name, d.executed_by_email) AS actor
           FROM deployment_history d LEFT JOIN users u ON u.email = d.executed_by_email
          WHERE d.project_id = ?
          ORDER BY d.created_at DESC, d.rowid DESC LIMIT ?`,
      )
      .all(projectId, MARKER_LIMIT) as {
      created_at: string;
      connection_name: string;
      environment: string | null;
      success: number;
      rollback_of: string | null;
      actor: string | null;
    }[];
    for (const row of deployments) {
      markers.push({
        kind: row.rollback_of ? "rollback" : "deployment",
        at: row.created_at,
        actor: row.actor,
        detail: row.connection_name,
        environment: row.environment,
        success: row.success === 1,
      });
    }
  }

  return markers.sort((a, b) => a.at.localeCompare(b.at));
}
