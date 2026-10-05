import type { FastifyInstance } from "fastify";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin, requireUser } from "../../shared/guards.js";
import {
  CREDENTIAL_SAVE_LIMIT,
  giveOwnCredentials,
  listOwnAccounts,
  ownCredentials,
  removeOwnCredentials,
  requireConnectionUser,
} from "./credentialService.js";
import { listCredentialHolders } from "./personalCredentials.js";
import { getConnectionById } from "./repository.js";
import { getAccountHint } from "../dbAccess/repository.js";

// Where the tests replace the one step that needs a live server; the object itself lives with the rules.
export { credentialCheck } from "./credentialService.js";

const READ_LIMIT = { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } };

/** One's own account on a database whose connection asks each user for theirs. */
export function registerCredentialRoutes(app: FastifyInstance): void {
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

  app.delete("/api/connections/:id/credentials", READ_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    return removeOwnCredentials(requireConnectionUser(req, id), req);
  });

  // Who has given an account — what an administrator checks before switching a connection to personal accounts.
  app.get("/api/admin/connections/:id/credentials", READ_LIMIT, async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    if (!getConnectionById(id)) throw new ApiError("CONNECTION_NOT_FOUND");
    return { holders: listCredentialHolders(id) };
  });
}
