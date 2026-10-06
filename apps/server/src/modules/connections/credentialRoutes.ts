import type { FastifyInstance } from "fastify";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin, requireUser } from "../../shared/guards.js";
import {
  CREDENTIAL_SAVE_LIMIT,
  changeOwnPassword,
  giveOwnCredentials,
  listOwnAccounts,
  ownCredentials,
  removeOwnCredentials,
  requireConnectionUser,
} from "./credentialService.js";
import { listCredentialHolders } from "./personalCredentials.js";
import { connectionOwner, getConnectionById } from "./repository.js";
import { getAccountHint } from "../dbAccess/repository.js";
import { effectiveDbAccess } from "../dbAccess/repository.js";
import { db } from "../../infrastructure/db.js";
import { credentialCheck as accountCheck } from "./credentialService.js";
import { parsePersonalCredentials, savePersonalCredentials, personalCredentialStatus } from "./personalCredentials.js";
import { auditUser } from "../../shared/audit.js";

// Where the tests replace the one step that needs a live server; the object itself lives with the rules.
export { credentialCheck, ownPasswordChange } from "./credentialService.js";

const READ_LIMIT = { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } };

/** One's own account on a database whose connection asks each user for theirs. */
export function registerCredentialRoutes(app: FastifyInstance): void {
  app.put("/api/admin/users/:userId/connections/:id/credentials", CREDENTIAL_SAVE_LIMIT, async (req) => {
    const admin = requireAdmin(req);
    const { userId, id } = req.params as { userId: string; id: string };
    const connection = getConnectionById(id);
    const target = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId) as
      { is_admin: number } | undefined;
    if (!connection || connectionOwner(id) || !target) throw new ApiError("CONNECTION_NOT_FOUND");
    if (!target.is_admin && !effectiveDbAccess(userId, id)) throw new ApiError("FORBIDDEN");
    if (connection.authMode !== "personal") throw new ApiError("PERSONAL_CREDENTIALS_NOT_USED");
    const { username, password } = parsePersonalCredentials(req.body);
    try {
      await accountCheck.verify({ ...connection, authMode: "shared", user: username, password });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError("PERSONAL_CREDENTIALS_REJECTED", {
        details: { reason: err instanceof Error ? err.message : String(err) },
      });
    }
    savePersonalCredentials(id, userId, username, password);
    auditUser(
      admin,
      "dbconn.credentials.set",
      { type: "connection", id },
      `${connection.name}: ${username} for user ${userId}`,
      req,
    );
    return personalCredentialStatus(connection, userId);
  });
  // All of the caller's accounts at once, for their Settings.
  app.get("/api/me/sql-accounts", READ_LIMIT, async (req) => ({
    accounts: listOwnAccounts(requireUser(req), Boolean(req.apiKey)),
  }));

  app.get("/api/connections/:id/credentials", READ_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    const caller = requireConnectionUser(req, id);
    // The account name an administrator associated with this person, to pre-fill
    // the dialog — a name only; the password is theirs to type.
    const suggestedUsername = getAccountHint(id, caller.user.id);
    return { ...ownCredentials(caller), ...(suggestedUsername ? { suggestedUsername } : {}) };
  });

  app.put("/api/connections/:id/credentials", CREDENTIAL_SAVE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    return giveOwnCredentials(requireConnectionUser(req, id), req.body, req);
  });

  // A new password for the account one already holds, set on the database itself.
  app.put("/api/connections/:id/credentials/password", CREDENTIAL_SAVE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    return changeOwnPassword(requireConnectionUser(req, id), req.body, req);
  });

  app.delete("/api/connections/:id/credentials", READ_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    return removeOwnCredentials(requireConnectionUser(req, id), req);
  });

  // Who has given an account — what an administrator checks before switching a connection to personal accounts.
  app.get("/api/admin/connections/:id/credentials", READ_LIMIT, async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    if (!getConnectionById(id) || connectionOwner(id)) throw new ApiError("CONNECTION_NOT_FOUND");
    return { holders: listCredentialHolders(id) };
  });
}
