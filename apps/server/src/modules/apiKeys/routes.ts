import type { FastifyInstance } from "fastify";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireProjectAccess } from "../../shared/guards.js";
import { requireSessionUser } from "./auth.js";
import { API_KEY_SCOPES, createApiKey, isApiKeyScope, listApiKeysByUser, revokeApiKey } from "./repository.js";

const MAX_NAME_LENGTH = 100;

/**
 * Management endpoints for a user's own `/api/v1` API keys. Session-cookie
 * only (deliberately not reachable with a key itself — a key that could mint
 * or revoke other keys would let a leaked key escalate into every key the
 * account owns).
 */
export function registerApiKeyRoutes(app: FastifyInstance): void {
  app.get("/api/keys", async (req) => {
    const user = requireSessionUser(req);
    return { keys: listApiKeysByUser(user.id) };
  });

  app.post("/api/keys", async (req, reply) => {
    const user = requireSessionUser(req);
    const body = (req.body ?? {}) as { name?: string; scopes?: unknown; projectId?: string | null };

    const name = body.name?.trim();
    if (!name) throw new ApiError("API_KEY_NAME_REQUIRED");
    if (name.length > MAX_NAME_LENGTH) throw new ApiError("NAME_TOO_LONG");

    const scopes = body.scopes;
    if (!Array.isArray(scopes) || scopes.length === 0 || !scopes.every(isApiKeyScope)) {
      throw new ApiError("API_KEY_SCOPES_INVALID");
    }

    const projectId = body.projectId ?? null;
    // A project-restricted key still has to name a project the caller can
    // actually see — otherwise this would be a way to probe for project ids.
    if (projectId) requireProjectAccess(req, projectId, "view");

    const created = createApiKey(user.id, name, scopes, projectId);
    auditUser(user, "apikey.create", { type: "user", id: user.id }, `${name} (${scopes.join(", ")})`, req);
    return reply.code(201).send(created);
  });

  app.delete("/api/keys/:id", async (req) => {
    const user = requireSessionUser(req);
    const { id } = req.params as { id: string };
    const ok = revokeApiKey(user.id, id);
    if (!ok) throw new ApiError("API_KEY_NOT_FOUND");
    auditUser(user, "apikey.revoke", { type: "user", id: user.id }, id, req);
    return { revoked: true };
  });

  app.get("/api/keys/scopes", async () => ({ scopes: API_KEY_SCOPES }));
}
