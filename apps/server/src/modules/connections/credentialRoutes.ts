import type { FastifyInstance, FastifyRequest } from "fastify";
import type { DatabaseConnectionConfig } from "@athanordb/shared";
import { db } from "../../infrastructure/db.js";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin, requireUser } from "../../shared/guards.js";
import { getEffectivePermission } from "../../shared/permissions.js";
import type { SessionUser } from "../auth/session.js";
import { createDatabaseDriver } from "./drivers/index.js";
import {
  deletePersonalCredentials,
  listCredentialHolders,
  parsePersonalCredentials,
  personalCredentialStatus,
  savePersonalCredentials,
} from "./personalCredentials.js";
import { getConnectionById } from "./repository.js";

const READ_LIMIT = { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } };
// Saving an account opens a connection with it: kept low so this route is no
// way to try passwords against a database account.
const SAVE_LIMIT = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

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

/**
 * Those who use a connection through Athanor: instance administrators (the
 * console) and the administrators of a project it is attached to (deploy,
 * pull, compare). Anyone else is told the connection does not exist.
 */
function requireConnectionUser(req: FastifyRequest, connectionId: string) {
  const user: SessionUser = requireUser(req);
  const connection = getConnectionById(connectionId);
  if (!connection) throw new ApiError("CONNECTION_NOT_FOUND");
  if (!user.isAdmin) {
    const projects = db
      .prepare("SELECT project_id FROM project_connection_links WHERE connection_id = ?")
      .all(connectionId) as { project_id: string }[];
    if (!projects.some((link) => getEffectivePermission(user.id, link.project_id) === "administrator")) {
      throw new ApiError("CONNECTION_NOT_FOUND");
    }
  }
  return { user, connection };
}

/** One's own account on a database whose connection asks each user for theirs. */
export function registerCredentialRoutes(app: FastifyInstance): void {
  app.get("/api/connections/:id/credentials", READ_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    const { user, connection } = requireConnectionUser(req, id);
    return personalCredentialStatus(connection, user.id);
  });

  app.put("/api/connections/:id/credentials", SAVE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    const { user, connection } = requireConnectionUser(req, id);
    if (connection.authMode !== "personal") throw new ApiError("PERSONAL_CREDENTIALS_NOT_USED");
    const { username, password } = parsePersonalCredentials(req.body);

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

    savePersonalCredentials(id, user.id, username, password);
    auditUser(user, "dbconn.credentials.set", { type: "connection", id }, `${connection.name}: ${username}`, req);
    return personalCredentialStatus(connection, user.id);
  });

  app.delete("/api/connections/:id/credentials", READ_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    const { user, connection } = requireConnectionUser(req, id);
    if (deletePersonalCredentials(id, user.id)) {
      auditUser(user, "dbconn.credentials.remove", { type: "connection", id }, connection.name, req);
    }
    return personalCredentialStatus(connection, user.id);
  });

  // Who has given an account — what an administrator checks before switching a connection to personal accounts.
  app.get("/api/admin/connections/:id/credentials", READ_LIMIT, async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    if (!getConnectionById(id)) throw new ApiError("CONNECTION_NOT_FOUND");
    return { holders: listCredentialHolders(id) };
  });
}
