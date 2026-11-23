import type { FastifyRequest } from "fastify";
import type { SessionUser } from "../auth/session.js";
import { getUserAccount } from "../users/repository.js";
import { ApiError } from "../../shared/errors.js";
import { resolveApiKeyByPlaintext, type ApiKeyKind, type ApiKeyScope } from "./repository.js";

export interface ApiKeyContext {
  keyId: string;
  scopes: ApiKeyScope[];
  /** `null` — the key works against any project its owning user can access. Set — locked to exactly that one project. */
  projectId: string | null;
  /** `agent`: an AI agent's key (MCP) — capped below its owner, see `ApiKeyKind`. */
  kind: ApiKeyKind;
  /** Whether the owner is an instance administrator. For an agent key `user.isAdmin` is always false. */
  ownerIsAdmin: boolean;
}

const BEARER_PREFIX = "Bearer ";

/**
 * Resolves an `Authorization: Bearer ndb_...` header into the user it was
 * issued for, mirroring `resolveSession`'s shape and contract: reads-only,
 * never rejects the request itself (an invalid/missing header just means "no
 * API key on this request", same as no cookie means "no session") — the
 * `onRequest` hook that calls this only *sets* `req.user`/`req.apiKey`, every
 * route still decides what it requires via `requireUser`/`requireScope`.
 *
 * A disabled account is refused the same as a cookie session would be: the
 * key can't outlive the account it authenticates as.
 */
export async function resolveApiKey(req: FastifyRequest): Promise<{ user: SessionUser; apiKey: ApiKeyContext } | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith(BEARER_PREFIX)) return null;
  const plaintextKey = header.slice(BEARER_PREFIX.length).trim();
  if (!plaintextKey) return null;

  const resolved = await resolveApiKeyByPlaintext(plaintextKey);
  if (!resolved) return null;

  const account = await getUserAccount(resolved.userId);
  if (!account || account.disabled_at) return null;

  const ownerIsAdmin = account.is_admin === 1;
  return {
    user: {
      id: account.id,
      email: account.email,
      // An AI agent never acts as an instance administrator, even for one: every `user.isAdmin`
      // check then refuses it, and `shared/permissions.ts` caps what the account's grants give.
      isAdmin: resolved.kind === "agent" ? false : ownerIsAdmin,
      displayName: account.display_name?.trim() || account.email.split("@")[0],
    },
    apiKey: {
      keyId: resolved.id,
      scopes: resolved.scopes,
      projectId: resolved.projectId,
      kind: resolved.kind,
      ownerIsAdmin,
    },
  };
}

/**
 * A user authenticated by session cookie specifically — not by an API key.
 * Key-management routes (`apiKeys/routes.ts`) use this instead of the
 * ordinary `requireUser`: a key that could itself mint or revoke keys would
 * let a single leaked key escalate into every key its owner has, so minting
 * and revoking are reachable only from a real browser session.
 */
export function requireSessionUser(req: FastifyRequest): SessionUser {
  if (!req.user || req.apiKey) throw new ApiError("AUTH_REQUIRED");
  return req.user;
}

/**
 * Scope + single-project-restriction check for a `/api/v1` route. A no-op for
 * a cookie-authenticated (non-API-key) request — the browser app itself isn't
 * scope-limited, only keys are — so this sits *alongside*
 * `requireProjectAccess`/`requireProjectAdmin`, never instead of them: this
 * narrows what a key can reach, permission still gates what the user behind
 * it can reach.
 */
export function requireScope(req: FastifyRequest, scope: ApiKeyScope, projectId?: string): void {
  const apiKey = req.apiKey;
  if (!apiKey) return; // cookie session — no key, no scope restriction
  if (!apiKey.scopes.includes(scope)) throw new ApiError("API_SCOPE_INSUFFICIENT");
  if (apiKey.projectId && projectId && apiKey.projectId !== projectId) {
    throw new ApiError("API_KEY_PROJECT_RESTRICTED");
  }
}

/**
 * `requireScope` for a route that touches several projects at once (a variant pushed to others, a
 * comparison): a key restricted to one project may touch that project and no other.
 */
export function requireScopeOn(req: FastifyRequest, scope: ApiKeyScope, projectIds: Iterable<string>): void {
  for (const projectId of projectIds) requireScope(req, scope, projectId);
}

/**
 * Scope check for a route with no single project to restrict against —
 * team management and database backups, which are instance-wide, not
 * per-project. A
 * project-restricted key is refused outright rather than silently let
 * through: "restricted to project X" implied a narrower key than "can
 * manage every team in the instance," and letting a global-admin-owned
 * restricted key reach this anyway would be a scope escape, not a
 * narrowing.
 */
export function requireGlobalScope(req: FastifyRequest, scope: ApiKeyScope): void {
  const apiKey = req.apiKey;
  if (!apiKey) return; // cookie session — no key, no scope restriction
  if (apiKey.projectId) throw new ApiError("API_KEY_PROJECT_RESTRICTED");
  if (!apiKey.scopes.includes(scope)) throw new ApiError("API_SCOPE_INSUFFICIENT");
}

/** Whether this request comes from an AI agent's key. */
export function isAgentRequest(req: FastifyRequest): boolean {
  return req.apiKey?.kind === "agent";
}

/**
 * Refuses an AI agent's key on a route it must never reach whatever its owner may do — creating
 * a project, for one. Most administration is refused already by the agent's permission ceiling;
 * this is for what no project permission gates.
 */
export function refuseAgentKey(req: FastifyRequest): void {
  if (isAgentRequest(req)) throw new ApiError("AGENT_KEY_FORBIDDEN");
}
