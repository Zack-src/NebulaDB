import crypto from "node:crypto";
import type {
  AdminConnectionSummary,
  ConnectionAuthMode,
  ConnectionOrigin,
  DatabaseConnectionConfig,
  DatabaseConnectionSummary,
  DatabaseEngine,
  StructurePolicy,
  StructurePolicySetting,
} from "@athanordb/shared";
import { db } from "../../infrastructure/db.js";
import { decryptPayload, encryptPayload } from "../../shared/crypto.js";
import { ApiError } from "../../shared/errors.js";
import { deleteBackupsOfConnection } from "../backups/repository.js";
import { getEnvironment, resolveConnectionEnvironment } from "../environments/repository.js";

interface ConnectionRow {
  id: string;
  owner_user_id: string | null;
  name: string;
  engine: string;
  environment: string | null;
  environment_id: string | null;
  config_encrypted: string;
  tags: string;
  origin: string;
  read_only: number;
  structure_policy: string | null;
  structure_policy_sql: number;
  auth_mode: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_status: string | null;
  last_checked_at: string | null;
  last_version: string | null;
  last_latency_ms: number | null;
  last_error: string | null;
}

/** What a caller may send when creating a connection: the stored config minus the fields the server assigns. */
export type ConnectionInput = Omit<DatabaseConnectionConfig, "id" | "projectId"> & { projectId?: string };

const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 40;

function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  for (const tag of tags) {
    if (typeof tag !== "string") continue;
    const trimmed = tag.trim().slice(0, MAX_TAG_LENGTH);
    if (trimmed) seen.add(trimmed);
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen];
}

function maskConnectionString(value: string | undefined): string | undefined {
  return value ? value.replace(/:([^@:/]+)@/, ":***@").replace(/(password|pwd)\s*=\s*[^;]*/gi, "$1=***") : undefined;
}

/** The connection's stage as the summary shows it — name, colour, production — or nothing. */
function stageFields(
  row: ConnectionRow,
): Pick<DatabaseConnectionSummary, "environment" | "environmentId" | "environmentColor" | "production"> {
  const stage = row.environment_id ? getEnvironment(row.environment_id) : null;
  if (!stage) return {};
  return {
    environment: stage.name,
    environmentId: stage.id,
    environmentColor: stage.color,
    production: stage.production,
  };
}

function rowToSummary(row: ConnectionRow, projectId: string): DatabaseConnectionSummary {
  const config = decryptPayload<DatabaseConnectionConfig>(row.config_encrypted);
  return {
    id: row.id,
    projectId,
    name: row.name,
    engine: row.engine as DatabaseEngine,
    ...stageFields(row),
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    hasPassword: Boolean(config.password && config.password.length > 0),
    ssl: config.ssl,
    connectionString: maskConnectionString(config.connectionString),
    filePath: config.filePath,
    authMode: row.auth_mode as ConnectionAuthMode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToConfig(row: ConnectionRow, projectId: string): DatabaseConnectionConfig {
  const config = decryptPayload<DatabaseConnectionConfig>(row.config_encrypted);
  return {
    ...config,
    id: row.id,
    projectId,
    name: row.name,
    engine: row.engine as DatabaseEngine,
    environment: row.environment ?? undefined,
    environmentId: row.environment_id,
    tags: parseTags(row.tags),
    readOnly: row.read_only === 1,
    authMode: row.auth_mode as ConnectionAuthMode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * A personal account replaces the connection's user and password, so there
 * have to be some to replace: not a SQLite file (no accounts), not a
 * connection string (the account is somewhere inside it).
 */
function assertAuthModeFits(
  mode: unknown,
  config: Pick<DatabaseConnectionConfig, "engine" | "connectionString">,
): void {
  if (mode !== "shared" && mode !== "personal") throw new ApiError("CONNECTION_AUTH_MODE_INVALID");
  if (mode === "personal" && (config.engine === "sqlite" || Boolean(config.connectionString?.trim()))) {
    throw new ApiError("CONNECTION_AUTH_MODE_INVALID");
  }
}

function getRow(id: string): ConnectionRow | undefined {
  return db.prepare("SELECT * FROM db_connections WHERE id = ?").get(id) as ConnectionRow | undefined;
}

/** The fields kept only in their own plain columns never go into the encrypted blob. */
function toBlob(config: Partial<DatabaseConnectionConfig>): string {
  const secret = { ...config };
  for (const key of [
    "tags",
    "readOnly",
    "structurePolicy",
    "authMode",
    "environment",
    "environmentId",
    "projectId",
    "createdAt",
    "updatedAt",
  ] as const) {
    delete secret[key];
  }
  return encryptPayload(secret);
}

export function listConnectionsByProject(projectId: string): DatabaseConnectionSummary[] {
  const rows = db
    .prepare(
      `SELECT c.* FROM db_connections c
         JOIN project_connection_links l ON l.connection_id = c.id
        WHERE l.project_id = ? ORDER BY c.created_at ASC`,
    )
    .all(projectId) as ConnectionRow[];
  return rows.map((row) => rowToSummary(row, projectId));
}

export function isConnectionLinked(projectId: string, connectionId: string): boolean {
  return (
    db
      .prepare("SELECT 1 FROM project_connection_links WHERE project_id = ? AND connection_id = ?")
      .get(projectId, connectionId) !== undefined
  );
}

/** The decrypted config, with no project context — the admin console's view of a connection. */
export function getConnectionById(id: string): DatabaseConnectionConfig | null {
  const row = getRow(id);
  return row ? rowToConfig(row, "") : null;
}

/**
 * The decrypted config *only if* the connection is attached to this project.
 * Every project-scoped route resolves a connection through here: a project
 * administrator must not be able to reach another project's (or an unlinked
 * global) connection just by knowing its id.
 */
export function getProjectConnection(projectId: string, connectionId: string): DatabaseConnectionConfig | null {
  if (!isConnectionLinked(projectId, connectionId)) return null;
  const row = getRow(connectionId);
  return row ? rowToConfig(row, projectId) : null;
}

export function getConnectionOrigin(id: string): ConnectionOrigin | null {
  const row = getRow(id);
  return row ? (row.origin as ConnectionOrigin) : null;
}

function insertConnection(config: ConnectionInput, origin: ConnectionOrigin, createdBy: string | null): string {
  const id = crypto.randomUUID();
  const stage = resolveConnectionEnvironment(config) ?? null;
  db.prepare(
    `INSERT INTO db_connections
       (id, name, engine, environment, environment_id, config_encrypted, tags, origin, read_only, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    config.name.trim(),
    config.engine,
    stage?.name ?? null,
    stage?.id ?? null,
    toBlob(config),
    JSON.stringify(normalizeTags(config.tags)),
    origin,
    config.readOnly ? 1 : 0,
    createdBy,
  );
  return id;
}

/** Creates a connection from inside a project and attaches it to that project. */
export function saveConnection(projectId: string, config: ConnectionInput): DatabaseConnectionSummary {
  const id = db.transaction(() => {
    const newId = insertConnection(config, "project", null);
    db.prepare("INSERT INTO project_connection_links (project_id, connection_id) VALUES (?, ?)").run(projectId, newId);
    return newId;
  })();
  return rowToSummary(getRow(id)!, projectId);
}

/** Creates a connection from the admin console, attached to nothing yet. */
export function createGlobalConnection(config: ConnectionInput, createdBy: string): AdminConnectionSummary {
  const id = insertConnection(config, "admin", createdBy);
  // The insert is shared with project-created connections, which never carry a policy.
  if (config.structurePolicy) applyUpdate(id, { structurePolicy: config.structurePolicy }, true);
  if (config.authMode && config.authMode !== "shared") {
    try {
      applyUpdate(id, { authMode: config.authMode }, true);
    } catch (err) {
      // Not half-created: a connection refused for its mode does not stay behind as a shared one.
      deleteConnection(id);
      throw err;
    }
  }
  return getAdminConnection(id)!;
}

function rowStructurePolicy(row: ConnectionRow): StructurePolicySetting | null {
  return row.structure_policy
    ? { policy: row.structure_policy as StructurePolicy, applyToSql: row.structure_policy_sql === 1 }
    : null;
}

/**
 * `allowPolicy`: the structure policy and the account mode are the instance
 * administrator's to set. A project route passes `false`, and whatever it
 * sent for them is ignored rather than trusted.
 */
function applyUpdate(id: string, updates: Partial<DatabaseConnectionConfig>, allowPolicy = false): boolean {
  const row = getRow(id);
  if (!row) return false;
  const existing = rowToConfig(row, "");

  const merged: DatabaseConnectionConfig = {
    ...existing,
    ...updates,
    // Preserve existing password if not provided in updates
    password: updates.password !== undefined && updates.password !== "" ? updates.password : existing.password,
  };
  // The summary only ever hands out a masked connection string; getting that
  // mask back means "unchanged", not "store these asterisks".
  if (
    updates.connectionString !== undefined &&
    updates.connectionString === maskConnectionString(existing.connectionString)
  ) {
    merged.connectionString = existing.connectionString;
  }

  // A connection is reached by a connection string or by host and port, never
  // both: the drivers prefer the string when there is one, so a string left
  // behind after switching to host and port would keep sending the connection
  // to the old address — and stale host fields would show next to a new string.
  // An empty string is how a client says "no connection string any more".
  if (updates.connectionString !== undefined) {
    if (!merged.connectionString?.trim()) {
      delete merged.connectionString;
    } else if (merged.connectionString !== existing.connectionString) {
      for (const key of ["host", "port", "database", "user", "password", "ssl"] as const) delete merged[key];
    }
  }

  // `environment`, `tags` and `read_only` live in their own plain columns
  // (not in the encrypted blob): they are operator labels and a policy flag,
  // not secrets, and are read on paths that have no reason to decrypt.
  // A stage, never free text: `resolveConnectionEnvironment` refuses an unknown name.
  const resolved = resolveConnectionEnvironment(updates);
  const stage =
    resolved !== undefined
      ? resolved
      : row.environment_id
        ? { id: row.environment_id, name: row.environment ?? "" }
        : null;
  const tags = updates.tags !== undefined ? normalizeTags(updates.tags) : (existing.tags ?? []);
  const readOnly = updates.readOnly !== undefined ? Boolean(updates.readOnly) : Boolean(existing.readOnly);
  const policy =
    allowPolicy && updates.structurePolicy !== undefined ? updates.structurePolicy : rowStructurePolicy(row);
  // Checked against the connection as it will be: an engine or a connection
  // string changed in the same request counts.
  const authMode = allowPolicy && updates.authMode !== undefined ? updates.authMode : row.auth_mode;
  assertAuthModeFits(authMode, merged);

  db.prepare(
    `UPDATE db_connections
        SET name = ?, engine = ?, environment = ?, environment_id = ?, config_encrypted = ?, tags = ?, read_only = ?,
            structure_policy = ?, structure_policy_sql = ?, auth_mode = ?, updated_at = datetime('now')
      WHERE id = ?`,
  ).run(
    merged.name,
    merged.engine,
    stage?.name ?? null,
    stage?.id ?? null,
    toBlob(merged),
    JSON.stringify(tags),
    readOnly ? 1 : 0,
    policy?.policy ?? null,
    policy?.applyToSql === false ? 0 : 1,
    authMode,
    id,
  );
  return true;
}

export function updateConnection(
  id: string,
  updates: Partial<DatabaseConnectionConfig>,
  projectId = "",
): DatabaseConnectionSummary | null {
  if (!applyUpdate(id, updates)) return null;
  return rowToSummary(getRow(id)!, projectId);
}

export function updateGlobalConnection(
  id: string,
  updates: Partial<DatabaseConnectionConfig>,
): AdminConnectionSummary | null {
  if (!applyUpdate(id, updates, true)) return null;
  return getAdminConnection(id);
}

/**
 * Deletes the connection itself, wherever it was attached. Deployment history
 * keeps its own snapshot of the name; its backups go with it — they hold its
 * data, and nothing would list them any more.
 */
export function deleteConnection(id: string): boolean {
  deleteBackupsOfConnection(id);
  return db.transaction(() => {
    db.prepare("DELETE FROM project_connection_links WHERE connection_id = ?").run(id);
    db.prepare("DELETE FROM admin_query_history WHERE connection_id = ?").run(id);
    db.prepare("DELETE FROM schema_fingerprints WHERE connection_id = ?").run(id);
    db.prepare("DELETE FROM db_connection_credentials WHERE connection_id = ?").run(id);
    db.prepare("DELETE FROM db_access_grants WHERE connection_id = ?").run(id);
    db.prepare("DELETE FROM db_account_hints WHERE connection_id = ?").run(id);
    db.prepare("DELETE FROM account_baselines WHERE connection_id = ?").run(id);
    db.prepare("DELETE FROM query_stats WHERE connection_id = ?").run(id);
    return db.prepare("DELETE FROM db_connections WHERE id = ?").run(id).changes > 0;
  })();
}

/**
 * Detaches a connection from one project. A connection that was created
 * through a project and is now attached to nothing is deleted with its
 * credentials; an admin-created one stays in the global list.
 */
export function unlinkProjectConnection(projectId: string, connectionId: string): boolean {
  return db.transaction(() => {
    const removed = db
      .prepare("DELETE FROM project_connection_links WHERE project_id = ? AND connection_id = ?")
      .run(projectId, connectionId).changes;
    if (removed === 0) return false;
    db.prepare("DELETE FROM schema_fingerprints WHERE project_id = ? AND connection_id = ?").run(
      projectId,
      connectionId,
    );
    db.prepare("DELETE FROM account_baselines WHERE project_id = ? AND connection_id = ?").run(projectId, connectionId);
    pruneOrphanProjectConnections();
    return true;
  })();
}

function pruneOrphanProjectConnections(): void {
  db.prepare(
    `DELETE FROM db_connections
      WHERE origin = 'project' AND owner_user_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM project_connection_links l WHERE l.connection_id = db_connections.id)`,
  ).run();
  db.prepare("DELETE FROM db_connection_credentials WHERE connection_id NOT IN (SELECT id FROM db_connections)").run();
  db.prepare("DELETE FROM db_access_grants WHERE connection_id NOT IN (SELECT id FROM db_connections)").run();
  db.prepare("DELETE FROM db_account_hints WHERE connection_id NOT IN (SELECT id FROM db_connections)").run();
}

function rowToAdminSummary(row: ConnectionRow): AdminConnectionSummary {
  const projects = db
    .prepare(
      `SELECT p.id AS id, p.name AS name FROM project_connection_links l
         JOIN projects p ON p.id = l.project_id
        WHERE l.connection_id = ? ORDER BY p.name COLLATE NOCASE`,
    )
    .all(row.id) as { id: string; name: string }[];
  return {
    ...rowToSummary(row, ""),
    origin: row.origin as ConnectionOrigin,
    tags: parseTags(row.tags),
    readOnly: row.read_only === 1,
    structurePolicy: rowStructurePolicy(row),
    projects,
    health: {
      status: (row.last_status as "online" | "offline" | null) ?? null,
      checkedAt: row.last_checked_at,
      version: row.last_version,
      latencyMs: row.last_latency_ms,
      error: row.last_error,
    },
  };
}

export function listAllConnections(): AdminConnectionSummary[] {
  const rows = db
    .prepare("SELECT * FROM db_connections WHERE owner_user_id IS NULL ORDER BY name COLLATE NOCASE, created_at")
    .all() as ConnectionRow[];
  return rows.map(rowToAdminSummary);
}

export function getAdminConnection(id: string): AdminConnectionSummary | null {
  const row = getRow(id);
  return row && !row.owner_user_id ? rowToAdminSummary(row) : null;
}

/** Replaces the set of projects a connection is attached to. Unknown project ids are ignored. */
export function setConnectionProjects(connectionId: string, projectIds: string[]): void {
  db.transaction(() => {
    db.prepare("DELETE FROM project_connection_links WHERE connection_id = ?").run(connectionId);
    const insert = db.prepare(
      `INSERT OR IGNORE INTO project_connection_links (project_id, connection_id)
       SELECT id, ? FROM projects WHERE id = ?`,
    );
    for (const projectId of new Set(projectIds)) insert.run(connectionId, projectId);
    db.prepare(
      `DELETE FROM schema_fingerprints
        WHERE connection_id = ?
          AND project_id NOT IN (SELECT project_id FROM project_connection_links WHERE connection_id = ?)`,
    ).run(connectionId, connectionId);
  })();
}

export interface HealthResult {
  ok: boolean;
  version?: string;
  latencyMs: number;
  error?: string;
}

export function recordConnectionHealth(id: string, result: HealthResult): void {
  db.prepare(
    `UPDATE db_connections
        SET last_status = ?, last_checked_at = datetime('now'), last_version = ?, last_latency_ms = ?, last_error = ?
      WHERE id = ?`,
  ).run(
    result.ok ? "online" : "offline",
    result.version ?? null,
    Math.round(result.latencyMs),
    result.ok ? null : (result.error ?? "unreachable").slice(0, 500),
    id,
  );
  // A short series for the "Santé" tab; a week is kept.
  db.prepare("INSERT INTO db_health_samples (connection_id, ok, latency_ms) VALUES (?, ?, ?)").run(
    id,
    result.ok ? 1 : 0,
    Math.round(result.latencyMs),
  );
  db.prepare("DELETE FROM db_health_samples WHERE connection_id = ? AND at < datetime('now', '-7 days')").run(id);
}

export function connectionOwner(id: string): string | null {
  return getRow(id)?.owner_user_id ?? null;
}
export function listPrivateConnections(userId: string): DatabaseConnectionSummary[] {
  return (
    db
      .prepare("SELECT * FROM db_connections WHERE owner_user_id = ? ORDER BY name COLLATE NOCASE")
      .all(userId) as ConnectionRow[]
  ).map((row) => rowToSummary(row, ""));
}
export function createPrivateConnection(config: ConnectionInput, userId: string): DatabaseConnectionSummary {
  return db.transaction(() => {
    const id = insertConnection({ ...config, authMode: "shared" }, "project", userId);
    db.prepare("UPDATE db_connections SET owner_user_id = ? WHERE id = ?").run(userId, id);
    return rowToSummary(getRow(id)!, "");
  })();
}
export function connectionSummary(id: string): DatabaseConnectionSummary | null {
  const row = getRow(id);
  return row ? rowToSummary(row, "") : null;
}
