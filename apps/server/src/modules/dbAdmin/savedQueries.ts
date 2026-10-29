import crypto from "node:crypto";
import type { DbSavedQuery } from "@nebuladb/shared";
import { db } from "../../infrastructure/db.js";

/** Per person and connection: a bound on what one account can pile up, not a feature. */
export const MAX_SAVED_QUERIES = 200;
export const MAX_SAVED_NAME_LENGTH = 120;
export const MAX_SAVED_DESCRIPTION_LENGTH = 500;

interface Row {
  id: string;
  connection_id: string;
  user_id: string;
  name: string;
  sql: string;
  description: string | null;
  shared: number;
  created_at: string;
  updated_at: string;
  author_name: string | null;
}

export interface SavedQueryRecord {
  id: string;
  userId: string;
  name: string;
  shared: boolean;
}

const SELECT = `SELECT q.*, COALESCE(NULLIF(u.display_name, ''), u.email) AS author_name
                  FROM saved_queries q LEFT JOIN users u ON u.id = q.user_id`;

function toEntry(row: Row, viewerId: string): DbSavedQuery {
  return {
    id: row.id,
    name: row.name,
    sql: row.sql,
    description: row.description,
    shared: row.shared === 1,
    mine: row.user_id === viewerId,
    authorName: row.author_name ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The viewer's own queries first, then the ones others shared, each by name. */
export async function listSavedQueries(connectionId: string, viewerId: string): Promise<DbSavedQuery[]> {
  const rows = (await db
    .prepare(
      `${SELECT} WHERE q.connection_id = ? AND (q.user_id = ? OR q.shared = 1)
        ORDER BY CASE WHEN q.user_id = ? THEN 0 ELSE 1 END, LOWER(q.name), q.id`,
    )
    .all(connectionId, viewerId, viewerId)) as Row[];
  return rows.map((row) => toEntry(row, viewerId));
}

export async function getSavedQuery(connectionId: string, id: string, viewerId: string): Promise<DbSavedQuery | null> {
  const row = (await db.prepare(`${SELECT} WHERE q.connection_id = ? AND q.id = ?`).get(connectionId, id)) as
    Row | undefined;
  return row ? toEntry(row, viewerId) : null;
}

/** Who wrote a query and whether it is shared — what an access decision needs, nothing more. */
export async function getSavedQueryRecord(connectionId: string, id: string): Promise<SavedQueryRecord | null> {
  const row = (await db
    .prepare("SELECT id, user_id, name, shared FROM saved_queries WHERE connection_id = ? AND id = ?")
    .get(connectionId, id)) as Pick<Row, "id" | "user_id" | "name" | "shared"> | undefined;
  return row ? { id: row.id, userId: row.user_id, name: row.name, shared: row.shared === 1 } : null;
}

export async function countSavedQueries(connectionId: string, userId: string): Promise<number> {
  const row = (await db
    .prepare("SELECT COUNT(*) AS n FROM saved_queries WHERE connection_id = ? AND user_id = ?")
    .get(connectionId, userId)) as { n: number };
  return row.n;
}

/** The id of the caller's own query of that name on the connection, if any. */
export async function findOwnSavedQueryByName(
  connectionId: string,
  userId: string,
  name: string,
): Promise<string | null> {
  const row = (await db
    .prepare("SELECT id FROM saved_queries WHERE connection_id = ? AND user_id = ? AND name = ?")
    .get(connectionId, userId, name)) as { id: string } | undefined;
  return row?.id ?? null;
}

export async function insertSavedQuery(input: {
  connectionId: string;
  userId: string;
  name: string;
  sql: string;
  description: string | null;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO saved_queries (id, connection_id, user_id, name, sql, description)
     VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.connectionId, input.userId, input.name, input.sql, input.description);
  return id;
}

export interface SavedQueryChanges {
  name?: string;
  sql?: string;
  description?: string | null;
  shared?: boolean;
}

export async function updateSavedQuery(id: string, changes: SavedQueryChanges): Promise<void> {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (changes.name !== undefined) {
    sets.push("name = ?");
    values.push(changes.name);
  }
  if (changes.sql !== undefined) {
    sets.push("sql = ?");
    values.push(changes.sql);
  }
  if (changes.description !== undefined) {
    sets.push("description = ?");
    values.push(changes.description);
  }
  if (changes.shared !== undefined) {
    sets.push("shared = ?");
    values.push(changes.shared ? 1 : 0);
  }
  if (sets.length === 0) return;
  await db
    .prepare(`UPDATE saved_queries SET ${sets.join(", ")}, updated_at = utc_now() WHERE id = ?`)
    .run(...values, id);
}

export async function deleteSavedQuery(id: string): Promise<boolean> {
  return (await db.prepare("DELETE FROM saved_queries WHERE id = ?").run(id)).changes > 0;
}
