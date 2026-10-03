import type { Id } from "./schema.js";

/** One entry in a project's revision history — the actual shape returned by `GET /api/projects/:id/revisions`. */
export interface RevisionMeta {
  id: Id;
  author: string;
  label: string | null;
  createdAt: string;
  /** What this revision changed in the schema, against the one listed before it. Absent on a labelled revision that changed nothing. */
  changes?: RevisionChanges;
}

/** A short account of one revision's schema change — enough for a line in the history, not the full diff. */
export interface RevisionChanges {
  /** Tables touched, by their name after the change (before it, for a removal). Capped — see `moreTables`. */
  tables: { name: string; status: "added" | "removed" | "changed" }[];
  /** How many further tables were touched beyond the ones listed. */
  moreTables: number;
  /** Relations added, removed or changed. */
  refs: number;
}

/**
 * Something that happened to a project outside its revisions, shown on the
 * history timeline — `GET /api/projects/:id/history/markers`. Deployments and
 * their rollbacks are only listed for project administrators, who are the
 * only ones who can read the deployment history.
 */
export interface HistoryMarker {
  kind: "lock" | "unlock" | "restore" | "deployment" | "rollback";
  /** `YYYY-MM-DD HH:MM:SS`, UTC — the same format as `RevisionMeta.createdAt`. */
  at: string;
  /** Display name (or e-mail) of whoever did it, when known. */
  actor: string | null;
  /** Lock: the table and level. Restore: the tables, for a partial one (empty for a whole one). Deployment: the connection's name. */
  detail: string;
  /** Restore only: when the revision that was restored had been made, if it still exists. */
  revisionAt?: string | null;
  /** Restore only: the revision the restore itself wrote — the marker belongs right before it. */
  producedRevisionId?: string;
  /** Deployment / rollback only. */
  environment?: string | null;
  success?: boolean;
}

/**
 * What the server pushes to a project's open sockets outside the Yjs sync and
 * awareness streams (WebSocket message type 2, a JSON string).
 *
 * `locks-changed`: a table lock was placed, changed or lifted — refetch
 * `GET /api/projects/:id/locks`. `table-locked`: an update this connection
 * just sent altered locked tables and was put back; `tables` names them.
 * `drift-changed`: a linked database was changed outside the schema, or was
 * just brought back in step — refetch `GET /api/projects/:id/drift`.
 */
export type ServerNotice =
  | { type: "locks-changed" }
  | { type: "table-locked"; tables: string[] }
  | { type: "drift-changed" }
  /** A table's seed was set or removed — refetch `GET /api/projects/:id/seeds`. */
  | { type: "seeds-changed" };

/** One database linked to a project, and whether it is known to have left the schema. `GET /api/projects/:id/drift`. */
export interface ProjectDriftEntry {
  connectionId: Id;
  connectionName: string;
  /** Set when a structural change was made from the console, outside the schema; cleared by a deployment, a pull, or a dismissal. */
  outOfSchemaAt: string | null;
  /** What was done, as the audit trail words it (`sql: alter table users`). */
  outOfSchemaDetail: string | null;
  /** When schema and database were last known to agree — the last deployment or pull. `null`: never. */
  referenceTakenAt: string | null;
}

/** `POST /api/projects/:id/connections/:connId/drift-check` — the database, read now. */
export interface DriftCheckResult {
  checkedAt: string;
  /** How many tables and relations differ between the database and the schema in the editor. */
  againstSchema: { tables: number; refs: number };
  /** Tables that changed in the database since the reference; `null` when there is no reference yet. */
  sinceReference: { added: string[]; removed: string[]; changed: string[] } | null;
}
