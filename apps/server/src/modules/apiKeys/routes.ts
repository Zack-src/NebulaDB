import type { FastifyInstance } from "fastify";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireProjectAccess } from "../../shared/guards.js";
import { requireSessionUser } from "./auth.js";
import {
  AGENT_KEY_SCOPES,
  API_KEY_SCOPES,
  createApiKey,
  isApiKeyKind,
  isApiKeyScope,
  listApiKeysByUser,
  revokeApiKey,
} from "./repository.js";
import { idParams, parseBody, parseParams, z } from "../../shared/validate.js";

/** `scopes` keeps its dedicated error code (API_KEY_SCOPES_INVALID), so it stays `unknown`. */
const createKeyBody = z.object({
  name: z.string().optional(),
  scopes: z.unknown().optional(),
  projectId: z.string().nullable().optional(),
  kind: z.unknown().optional(),
});

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
    return { keys: await listApiKeysByUser(user.id) };
  });

  app.post("/api/keys", async (req, reply) => {
    const user = requireSessionUser(req);
    const body = parseBody(createKeyBody, req);

    const name = body.name?.trim();
    if (!name) throw new ApiError("API_KEY_NAME_REQUIRED");
    if (name.length > MAX_NAME_LENGTH) throw new ApiError("NAME_TOO_LONG");

    const kind = body.kind ?? "standard";
    if (!isApiKeyKind(kind))
      throw new ApiError("API_KEY_SCOPES_INVALID", { message: "kind must be standard or agent" });

    const scopes = body.scopes;
    if (!Array.isArray(scopes) || scopes.length === 0 || !scopes.every((scope) => isApiKeyScope(scope, kind))) {
      throw new ApiError("API_KEY_SCOPES_INVALID");
    }
    // An agent finds its way by reading: every other right of an agent key is useless without it.
    if (kind === "agent" && !scopes.includes("projects:read")) {
      throw new ApiError("API_KEY_SCOPES_INVALID", { message: "an agent key needs projects:read" });
    }

    const projectId = body.projectId ?? null;
    // A project-restricted key still has to name a project the caller can
    // actually see — otherwise this would be a way to probe for project ids.
    if (projectId) await requireProjectAccess(req, projectId, "view");

    const unique = [...new Set(scopes)];
    const created = await createApiKey(user.id, name, unique, projectId, kind);
    await auditUser(
      user,
      "apikey.create",
      { type: "user", id: user.id },
      `${name}${kind === "agent" ? " [AI agent]" : ""} (${unique.join(", ")})`,
      req,
    );
    return reply.code(201).send(created);
  });

  app.delete("/api/keys/:id", async (req) => {
    const user = requireSessionUser(req);
    const { id } = parseParams(idParams, req);
    const ok = await revokeApiKey(user.id, id);
    if (!ok) throw new ApiError("API_KEY_NOT_FOUND");
    await auditUser(user, "apikey.revoke", { type: "user", id: user.id }, id, req);
    return { revoked: true };
  });

  app.get("/api/keys/scopes", async () => ({ scopes: API_KEY_SCOPES, agentScopes: AGENT_KEY_SCOPES }));
}
