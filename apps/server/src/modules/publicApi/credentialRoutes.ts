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
 * The app's guard (`requireConnectionUser`), then the scope `connections:manage`.
 *
 * A connection is instance-level, so a project-restricted key is held to its project here:
 * the connection must be attached to it, and the owner's right to use it must come from it.
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
