import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireScope } from "../apiKeys/auth.js";
import { ApiError } from "../../shared/errors.js";
import { getEffectivePermission } from "../../shared/permissions.js";
import {
  CREDENTIAL_SAVE_LIMIT,
  type ConnectionUser,
  giveOwnCredentials,
  ownCredentials,
  removeOwnCredentials,
  requireConnectionUser,
} from "../connections/credentialService.js";
import { API_RATE_LIMIT } from "./rateLimits.js";

/**
 * The app's guard (`requireConnectionUser`: instance administrators and the
 * administrators of a project the connection is attached to; anyone else is
 * told it does not exist), then the scope `connections:manage`.
 *
 * A connection is an instance-level object, so there is no project in the
 * path to hold a restricted key to. Rather than refuse such a key outright
 * (`requireGlobalScope`, as the backups do — but a job that deploys one
 * project is exactly who needs this route) or let it through unscoped
 * (`requireScope` with no project, which checks nothing), the key is held to
 * its project here: the connection must be attached to that project, and the
 * owner's right to use it must come from that project — not from another one
 * the connection happens to be attached to as well.
 */
function requireCredentialAccess(req: FastifyRequest, connectionId: string): ConnectionUser {
  const access = requireConnectionUser(req, connectionId);
  requireScope(req, "connections:manage");
  const restrictedTo = req.apiKey?.projectId;
  if (restrictedTo) {
    const throughIt =
      access.projectIds.includes(restrictedTo) &&
      (access.user.isAdmin || getEffectivePermission(access.user.id, restrictedTo) === "administrator");
    if (!throughIt) throw new ApiError("API_KEY_PROJECT_RESTRICTED");
  }
  return access;
}

/**
 * One's own database account under `/api/v1`, for a connection that asks each
 * user for theirs. A key acts as its owner, so this is how the owner of a CI
 * job's key gives the account that job's deployments run as — with the app's
 * own rules (`connections/credentialService.ts`).
 */
export function registerPublicCredentialRoutes(app: FastifyInstance): void {
  app.get("/api/v1/connections/:id/credentials", API_RATE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    return ownCredentials(requireCredentialAccess(req, id));
  });

  // Opens a connection with the account given: the app's own low limit, so this is no way to try passwords.
  app.put("/api/v1/connections/:id/credentials", CREDENTIAL_SAVE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    return giveOwnCredentials(requireCredentialAccess(req, id), req.body, req, " (v1)");
  });

  app.delete("/api/v1/connections/:id/credentials", API_RATE_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    return removeOwnCredentials(requireCredentialAccess(req, id), req, " (v1)");
  });
}
