import crypto from "node:crypto";
import type { DatabaseConnectionConfig, PersonalCredentialHolder, PersonalCredentialStatus } from "@nebuladb/shared";
import { currentActorId } from "../../infrastructure/actor.js";
import { db } from "../../infrastructure/db.js";
import { decryptPayload, encryptPayload } from "../../shared/crypto.js";
import { ApiError } from "../../shared/errors.js";

/**
 * Personal database accounts. In `personal` mode each user gives their own account, and
 * everything done through Nebula (deploy, pull, compare, browse, SQL, backup) runs as it, so
 * the database's own logs and permissions apply.
 *
 * The connection's own account stays the **service account** for unattended work (watch,
 * scheduled backups, health checks). A person never falls back to it:
 * no personal account, no connection (`PERSONAL_CREDENTIALS_REQUIRED`).
 */

interface CredentialRow {
  id: string;
  connection_id: string;
  user_id: string;
  username: string;
  secret_encrypted: string;
  updated_at: string;
}

const MAX_USERNAME = 128;
const MAX_PASSWORD = 1024;

/** What a user sent as their account: a name and a password, nothing that could carry a second option into a driver. */
export function parsePersonalCredentials(body: unknown): { username: string; password: string } {
  const raw = (body ?? {}) as Record<string, unknown>;
  const username = typeof raw.username === "string" ? raw.username.trim() : "";
  const password = raw.password;
  // eslint-disable-next-line no-control-regex
  const hasControl = (text: string) => /[\u0000-\u001f\u007f]/.test(text);
  if (!username || username.length > MAX_USERNAME || hasControl(username)) {
    throw new ApiError("PERSONAL_CREDENTIALS_INVALID");
  }
  if (typeof password !== "string" || !password || password.length > MAX_PASSWORD || hasControl(password)) {
    throw new ApiError("PERSONAL_CREDENTIALS_INVALID");
  }
  return { username, password };
}

function getRow(connectionId: string, userId: string): CredentialRow | undefined {
  return db
    .prepare("SELECT * FROM db_connection_credentials WHERE connection_id = ? AND user_id = ?")
    .get(connectionId, userId) as CredentialRow | undefined;
}

/** Whether this user has an account on this connection, and under which name — never the password. */
export function personalCredentialStatus(
  connection: Pick<DatabaseConnectionConfig, "id" | "authMode">,
  userId: string,
): PersonalCredentialStatus {
  const row = getRow(connection.id, userId);
  return {
    authMode: connection.authMode ?? "shared",
    username: row?.username ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

/** The account itself, password included — for the one caller that has to sign in as it to change that password. */
export function readPersonalCredentials(
  connectionId: string,
  userId: string,
): { username: string; password: string } | null {
  const row = getRow(connectionId, userId);
  if (!row) return null;
  return { username: row.username, password: decryptPayload<{ password: string }>(row.secret_encrypted).password };
}

export function savePersonalCredentials(
  connectionId: string,
  userId: string,
  username: string,
  password: string,
): void {
  db.prepare(
    `INSERT INTO db_connection_credentials (id, connection_id, user_id, username, secret_encrypted)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(connection_id, user_id) DO UPDATE SET
       username = excluded.username, secret_encrypted = excluded.secret_encrypted, updated_at = datetime('now')`,
  ).run(crypto.randomUUID(), connectionId, userId, username, encryptPayload({ password }));
}

export function deletePersonalCredentials(connectionId: string, userId: string): boolean {
  return (
    db
      .prepare("DELETE FROM db_connection_credentials WHERE connection_id = ? AND user_id = ?")
      .run(connectionId, userId).changes > 0
  );
}

/** Who has an account on this connection — for its administrators: names, never passwords. */
export function listCredentialHolders(connectionId: string): PersonalCredentialHolder[] {
  return db
    .prepare(
      `SELECT c.user_id AS userId, u.email AS email, c.username AS username, c.updated_at AS updatedAt
           FROM db_connection_credentials c JOIN users u ON u.id = c.user_id
          WHERE c.connection_id = ? ORDER BY u.email COLLATE NOCASE`,
    )
    .all(connectionId) as PersonalCredentialHolder[];
}

/** The database accounts an Nebula account has given — for its personal-data export. */
export function listPersonalCredentialsOf(
  userId: string,
): { connection: string; username: string; updatedAt: string }[] {
  return db
    .prepare(
      `SELECT d.name AS connection, c.username AS username, c.updated_at AS updatedAt
         FROM db_connection_credentials c JOIN db_connections d ON d.id = c.connection_id
        WHERE c.user_id = ? ORDER BY d.name COLLATE NOCASE`,
    )
    .all(userId) as { connection: string; username: string; updatedAt: string }[];
}

/**
 * The config a driver should be opened with, given who is asking.
 *
 * Called by the two functions every driver comes from (`createDatabaseDriver`,
 * `createAdminDriver`), so no route can open a `personal` connection as the
 * service account by forgetting to ask. A config that is not a stored
 * connection (a "test this configuration" body) has no id and is left alone.
 */
export function configForActor(config: DatabaseConnectionConfig): DatabaseConnectionConfig {
  if (config.authMode !== "personal" || !config.id) return config;
  const actor = currentActorId();
  // Nobody behind this: a scheduled job, which is what the service account is for.
  if (!actor) return config;
  const row = getRow(config.id, actor);
  if (!row) {
    throw new ApiError("PERSONAL_CREDENTIALS_REQUIRED", {
      details: { connectionId: config.id, connectionName: config.name },
    });
  }
  const { password } = decryptPayload<{ password: string }>(row.secret_encrypted);
  return { ...config, user: row.username, password };
}
