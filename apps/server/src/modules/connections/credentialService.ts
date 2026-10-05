import type { FastifyRequest } from "fastify";
import type { DatabaseConnectionConfig, PersonalCredentialStatus } from "@athanordb/shared";
import { db } from "../../infrastructure/db.js";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireUser } from "../../shared/guards.js";
import { getEffectivePermission } from "../../shared/permissions.js";
import type { SessionUser } from "../auth/session.js";
import { createDatabaseDriver } from "./drivers/index.js";
import {
  deletePersonalCredentials,
  parsePersonalCredentials,
  personalCredentialStatus,
  savePersonalCredentials,
} from "./personalCredentials.js";
import { getConnectionById } from "./repository.js";
import { effectiveDbAccess } from "../dbAccess/repository.js";

/**
 * What giving, reading and removing one's own database account does, whoever
 * asks: the app's routes (`credentialRoutes.ts`) and `/api/v1`'s
 * (`publicApi/credentialRoutes.ts`) both call these, so the two cannot drift.
 */

// Saving an account opens a connection with it: kept low so no route that
// saves one is a way to try passwords against a database account.
export const CREDENTIAL_SAVE_LIMIT = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

/**
 * Tries the account before it is stored. An object rather than a function so
 * a test can replace the one step that needs a live server.
 */
export const credentialCheck = {
  async verify(config: DatabaseConnectionConfig): Promise<void> {
    const driver = await createDatabaseDriver(config);
    try {
      const result = await driver.testConnection();
      if (!result.ok) throw new Error(result.error ?? "connection refused");
    } finally {
      await driver.close().catch(() => {});
    }
  },
};

export interface ConnectionUser {
  user: SessionUser;
  connection: DatabaseConnectionConfig;
  /** The projects the connection is attached to. */
  projectIds: string[];
}

/**
 * Those who use a connection through Athanor: instance administrators (the
 * console), the administrators of a project it is attached to (deploy, pull,
 * compare) and, from a browser session, the members an instance administrator
 * granted access to it (explorer and SQL — see `dbAccess/`). Anyone else is
 * told the connection does not exist.
 */
export function requireConnectionUser(req: FastifyRequest, connectionId: string): ConnectionUser {
  const user: SessionUser = requireUser(req);
  const connection = getConnectionById(connectionId);
  if (!connection) throw new ApiError("CONNECTION_NOT_FOUND");
  const projectIds = (
    db.prepare("SELECT project_id FROM project_connection_links WHERE connection_id = ?").all(connectionId) as {
      project_id: string;
    }[]
  ).map((link) => link.project_id);
  const granted = !req.apiKey && effectiveDbAccess(user.id, connectionId) !== null;
  if (!user.isAdmin && !granted && !projectIds.some((id) => getEffectivePermission(user.id, id) === "administrator")) {
    throw new ApiError("CONNECTION_NOT_FOUND");
  }
  return { user, connection, projectIds };
}

/** The caller's own account on this connection — its name, never its password. */
export function ownCredentials({ user, connection }: ConnectionUser): PersonalCredentialStatus {
  return personalCredentialStatus(connection, user.id);
}

/**
 * Keeps the account in `body` as the caller's own on this connection, once the
 * database has accepted it. `via` marks, in the audit trail, a surface other
 * than the app.
 */
export async function giveOwnCredentials(
  { user, connection }: ConnectionUser,
  body: unknown,
  req: FastifyRequest,
  via = "",
): Promise<PersonalCredentialStatus> {
  if (connection.authMode !== "personal") throw new ApiError("PERSONAL_CREDENTIALS_NOT_USED");
  const { username, password } = parsePersonalCredentials(body);

  // Tried as given, on the connection's own target: `shared` so the driver
  // uses exactly this account rather than looking one up again.
  try {
    await credentialCheck.verify({ ...connection, authMode: "shared", user: username, password });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("PERSONAL_CREDENTIALS_REJECTED", {
      details: { reason: err instanceof Error ? err.message : String(err) },
    });
  }

  savePersonalCredentials(connection.id, user.id, username, password);
  auditUser(
    user,
    "dbconn.credentials.set",
    { type: "connection", id: connection.id },
    `${connection.name}: ${username}${via}`,
    req,
  );
  return personalCredentialStatus(connection, user.id);
}

/** Forgets the caller's own account on this connection; says nothing in the audit trail when there was none. */
export function removeOwnCredentials(
  { user, connection }: ConnectionUser,
  req: FastifyRequest,
  via = "",
): PersonalCredentialStatus {
  if (deletePersonalCredentials(connection.id, user.id)) {
    auditUser(
      user,
      "dbconn.credentials.remove",
      { type: "connection", id: connection.id },
      `${connection.name}${via}`,
      req,
    );
  }
  return personalCredentialStatus(connection, user.id);
}
