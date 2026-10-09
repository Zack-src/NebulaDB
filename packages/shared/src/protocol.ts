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
  | { type: "seeds-changed" }
  /** The linter's settings changed — refetch `GET /api/projects/:id/lint`. */
  | { type: "lint-changed" }
  /**
   * A notification was just stored for this connection's account — refetch
   * `GET /api/notifications`. Sent to that account's connections only, never
   * to the room: who follows what is nobody else's business.
   */
  | { type: "notification" };

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

/**
 * A project's watch over its databases (`GET/PUT /api/projects/:id/monitoring`):
 * every `intervalMinutes`, each linked database that has a reference
 * (a deployment or a pull happened) is read again and compared with it.
 */
export interface MonitorSettings {
  enabled: boolean;
  intervalMinutes: number;
  /** Table names whose changes are not reported. */
  ignoreTables: string[];
  lastCheckedAt: string | null;
  /**
   * Set when an instance administrator imposes the watch from a connection the
   * project is attached to: `enabled` is then true and `intervalMinutes` at most
   * the connections', whatever the project chose, and only instance
   * administrators change the rest. `connections`: the names of those connections.
   */
  forced?: { intervalMinutes: number; connections: string[] } | null;
}

export const MONITOR_INTERVALS: readonly number[] = [5, 15, 60, 360, 1440];

/**
 * Something the watch found. `external`: the database changed since Nebula
 * last deployed or pulled, and no deployment explains it. `partial-deployment`:
 * the change matches a deployment that failed half-way. `unreachable`: the
 * database could not be read — never reported as a change. `accounts`: the
 * database's accounts or privileges changed and no Nebula action explains it
 * (only shown to the project's administrators; `added` / `removed` are then
 * canonical account lines and `accountChanges` says what they mean).
 */
export interface DriftEvent {
  id: Id;
  connectionId: Id;
  connectionName: string | null;
  kind: "external" | "partial-deployment" | "unreachable" | "accounts";
  detectedAt: string;
  added: string[];
  removed: string[];
  changed: string[];
  error: string | null;
  status: "open" | "resolved" | "ignored";
  resolvedAt: string | null;
  /** Set on an `accounts` event. */
  accountChanges?: AccountChange[];
}

/**
 * One change to a database's accounts, as the accounts watch reads it. Names
 * and privileges only — never a password or its hash.
 */
export interface AccountChange {
  type:
    | "created"
    | "dropped"
    | "locked"
    | "unlocked"
    | "login-granted"
    | "login-removed"
    | "superuser-granted"
    | "superuser-removed"
    | "role-granted"
    | "role-revoked"
    | "privilege-granted"
    | "privilege-revoked";
  /** The account or role, as the engine names it (`name@host` on MySQL, `database/name` for a SQL Server database user). */
  principal: string;
  /** The role, for `role-*`. */
  role?: string;
  /** For `privilege-*`: the privilege, the scope and the object it applies to. */
  privilege?: string;
  scope?: string;
  object?: string;
}

/**
 * The accounts watch of a project (`GET /api/projects/:id/monitoring`, for its
 * administrators): whether it is on — only an instance administrator turns it
 * on or off — and, per linked database that has accounts, the reference it
 * compares with.
 */
export interface AccountWatchState {
  enabled: boolean;
  /** Whether the caller may switch it (instance administrator). */
  canManage: boolean;
  connections: {
    connectionId: Id;
    connectionName: string;
    engine: string;
    /** When the reference was taken; `null` before the first read. */
    referenceAt: string | null;
    /** The last read failed: why (the service account may lack the rights to list accounts). */
    lastError: string | null;
    /** The database differs from the reference right now. */
    differs: boolean;
  }[];
}

/**
 * What a project's follower can be told about. Each is something that
 * happened *to the project*, said once — not every keystroke of an edit.
 */
export const NOTIFICATION_EVENTS = ["deployment", "lock", "seed", "drift"] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/**
 * Notifications addressed to one person rather than to a project's followers:
 * they arrive whether or not the project is followed, since someone chose to
 * write to that person — a comment that mentions them, a reply in a thread
 * they wrote in.
 */
export const DIRECT_NOTIFICATION_EVENTS = ["mention", "reply"] as const;
export type DirectNotificationEvent = (typeof DIRECT_NOTIFICATION_EVENTS)[number];

/** Short facts the client words in the reader's language: names, never free text from a database. */
export type NotificationParams = Record<string, string | number | boolean | null>;

/** `GET/PUT /api/projects/:id/subscription` — the events the signed-in user follows on the project. */
export interface ProjectSubscription {
  events: NotificationEvent[];
}

/** One entry of `GET /api/notifications`. */
export interface UserNotification {
  id: string;
  /** `null` once the project is gone. */
  projectId: string | null;
  projectName: string | null;
  event: NotificationEvent | DirectNotificationEvent;
  params: NotificationParams;
  createdAt: string;
  read: boolean;
}
