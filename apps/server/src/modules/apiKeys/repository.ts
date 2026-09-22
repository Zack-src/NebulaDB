import crypto from "node:crypto";
import { db } from "../../infrastructure/db.js";

/**
 * Scopes an API key can carry — checked in addition to, never instead of, the
 * normal `getEffectivePermission` permission model: a key authenticates *as*
 * its owning user, and a scope only ever narrows what that user could
 * already do, it can't grant more.
 */
export type ApiKeyScope =
  "projects:read" | "projects:write" | "deployments:trigger" | "connections:manage" | "teams:manage";

export const API_KEY_SCOPES: ApiKeyScope[] = [
  "projects:read",
  "projects:write",
  "deployments:trigger",
  "connections:manage",
  "teams:manage",
];

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
  return typeof value === "string" && (API_KEY_SCOPES as string[]).includes(value);
}

const KEY_PREFIX = "adb";
/** 10 chars of the plaintext key kept for display (`adb_3f9a2b81…`), never enough to guess the rest. */
const DISPLAY_PREFIX_LENGTH = 10;

export interface ApiKeyRow {
  id: string;
  user_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  scopes: string;
  project_id: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: ApiKeyScope[];
  projectId: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

function toSummary(row: ApiKeyRow): ApiKeySummary {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: JSON.parse(row.scopes) as ApiKeyScope[],
    projectId: row.project_id,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

/** SHA-256 rather than a slow password hash on purpose: the key itself is 32 random bytes, already high-entropy — there is nothing a slow hash defends against here that a fast one doesn't, and a lookup runs on every authenticated `/api/v1` request. */
function hashKey(plaintextKey: string): string {
  return crypto.createHash("sha256").update(plaintextKey).digest("hex");
}

export interface CreatedApiKey {
  summary: ApiKeySummary;
  /** The full plaintext key — returned once, at creation, and never again. */
  plaintextKey: string;
}

export function createApiKey(
  userId: string,
  name: string,
  scopes: ApiKeyScope[],
  projectId: string | null,
): CreatedApiKey {
  const id = crypto.randomUUID();
  const secret = crypto.randomBytes(32).toString("base64url");
  const plaintextKey = `${KEY_PREFIX}_${secret}`;
  const keyPrefix = plaintextKey.slice(0, DISPLAY_PREFIX_LENGTH);

  db.prepare(
    `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scopes, project_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, name, hashKey(plaintextKey), keyPrefix, JSON.stringify(scopes), projectId);

  return {
    plaintextKey,
    summary: {
      id,
      name,
      keyPrefix,
      scopes,
      projectId,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
    },
  };
}

/** The caller's own keys, redacted (never the hash) — newest first. */
export function listApiKeysByUser(userId: string): ApiKeySummary[] {
  const rows = db
    .prepare(
      `SELECT id, user_id, name, key_hash, key_prefix, scopes, project_id, last_used_at, revoked_at, created_at
       FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`,
    )
    .all(userId) as ApiKeyRow[];
  return rows.map(toSummary);
}

export interface ResolvedApiKey {
  id: string;
  userId: string;
  scopes: ApiKeyScope[];
  projectId: string | null;
}

/**
 * Looks up a live (non-revoked) key by its plaintext value, hashing it first
 * — the hash is the only thing ever compared or stored. Touches
 * `last_used_at` on every successful resolution, same spirit as a session's
 * rolling expiry, so a listing can show which keys are actually in use.
 */
export function resolveApiKeyByPlaintext(plaintextKey: string): ResolvedApiKey | null {
  const row = db
    .prepare(`SELECT id, user_id, scopes, project_id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL`)
    .get(hashKey(plaintextKey)) as
    { id: string; user_id: string; scopes: string; project_id: string | null } | undefined;
  if (!row) return null;

  db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(row.id);

  return {
    id: row.id,
    userId: row.user_id,
    scopes: JSON.parse(row.scopes) as ApiKeyScope[],
    projectId: row.project_id,
  };
}

/** Revokes one of the caller's own keys. Scoped by `user_id` so an id guessed/enumerated from elsewhere is useless. */
export function revokeApiKey(userId: string, keyId: string): boolean {
  return (
    db
      .prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
      .run(keyId, userId).changes > 0
  );
}
