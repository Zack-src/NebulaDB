import crypto from "node:crypto";
import type { DatabaseConnectionConfig, DatabaseConnectionSummary, DatabaseEngine } from "@athanordb/shared";
import { db } from "../../infrastructure/db.js";
import { decryptPayload, encryptPayload } from "../../shared/crypto.js";

interface ConnectionRow {
  id: string;
  project_id: string;
  name: string;
  engine: string;
  environment: string | null;
  config_encrypted: string;
  created_at: string;
  updated_at: string;
}

function rowToSummary(row: ConnectionRow): DatabaseConnectionSummary {
  const config = decryptPayload<DatabaseConnectionConfig>(row.config_encrypted);
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    engine: row.engine as DatabaseEngine,
    environment: row.environment ?? undefined,
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    hasPassword: Boolean(config.password && config.password.length > 0),
    ssl: config.ssl,
    connectionString: config.connectionString ? config.connectionString.replace(/:([^@:]+)@/, ":***@") : undefined,
    filePath: config.filePath,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listConnectionsByProject(projectId: string): DatabaseConnectionSummary[] {
  const rows = db
    .prepare("SELECT * FROM project_connections WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId) as ConnectionRow[];
  return rows.map(rowToSummary);
}

export function getConnectionById(id: string): DatabaseConnectionConfig | null {
  const row = db.prepare("SELECT * FROM project_connections WHERE id = ?").get(id) as ConnectionRow | undefined;
  if (!row) return null;
  const config = decryptPayload<DatabaseConnectionConfig>(row.config_encrypted);
  return {
    ...config,
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    engine: row.engine as DatabaseEngine,
    environment: row.environment ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function saveConnection(
  projectId: string,
  config: Omit<DatabaseConnectionConfig, "id">,
): DatabaseConnectionSummary {
  const id = crypto.randomUUID();
  const encrypted = encryptPayload(config);

  db.prepare(
    `
    INSERT INTO project_connections (id, project_id, name, engine, environment, config_encrypted, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `,
  ).run(id, projectId, config.name, config.engine, config.environment?.trim() || null, encrypted);

  const row = db.prepare("SELECT * FROM project_connections WHERE id = ?").get(id) as ConnectionRow;
  return rowToSummary(row);
}

export function updateConnection(
  id: string,
  updates: Partial<DatabaseConnectionConfig>,
): DatabaseConnectionSummary | null {
  const existing = getConnectionById(id);
  if (!existing) return null;

  const merged: DatabaseConnectionConfig = {
    ...existing,
    ...updates,
    // Preserve existing password if not provided in updates
    password: updates.password !== undefined && updates.password !== "" ? updates.password : existing.password,
  };

  const encrypted = encryptPayload(merged);
  // `environment` is stored in its own plain column (not part of the
  // encrypted blob) purely so `deploymentHistory.ts` can read it with a
  // simple join-free query when stamping a history row — it's an operator
  // label, not a secret, so there's no reason to pay the decrypt cost to
  // read it back.
  const environment = (updates.environment !== undefined ? updates.environment : existing.environment)?.trim() || null;

  db.prepare(
    `
    UPDATE project_connections
    SET name = ?, engine = ?, environment = ?, config_encrypted = ?, updated_at = datetime('now')
    WHERE id = ?
  `,
  ).run(merged.name, merged.engine, environment, encrypted, id);

  const row = db.prepare("SELECT * FROM project_connections WHERE id = ?").get(id) as ConnectionRow;
  return rowToSummary(row);
}

export function deleteConnection(id: string): boolean {
  const res = db.prepare("DELETE FROM project_connections WHERE id = ?").run(id);
  return res.changes > 0;
}
