import { request } from "./httpClient";

export type ApiKeyScope =
  "projects:read" | "projects:write" | "deployments:trigger" | "connections:manage" | "teams:manage" | "sql:execute";

/** `agent`: the key an AI agent connects with (MCP). The server caps it below its owner. */
export type ApiKeyKind = "standard" | "agent";

export const API_KEY_SCOPES: ApiKeyScope[] = [
  "projects:read",
  "projects:write",
  "deployments:trigger",
  "connections:manage",
  "teams:manage",
];

/** What an AI agent's key may carry; `projects:read` is always on. */
export const AGENT_KEY_SCOPES: ApiKeyScope[] = [
  "projects:read",
  "projects:write",
  "deployments:trigger",
  "sql:execute",
];

export interface ApiKeySummary {
  id: string;
  name: string;
  kind: ApiKeyKind;
  keyPrefix: string;
  scopes: ApiKeyScope[];
  projectId: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedApiKey {
  summary: ApiKeySummary;
  /** The full key — shown once, at creation, and never retrievable again. */
  plaintextKey: string;
}

export function listApiKeys(): Promise<ApiKeySummary[]> {
  return request<{ keys: ApiKeySummary[] }>("/api/keys").then((res) => res.keys);
}

export function createApiKey(
  name: string,
  scopes: ApiKeyScope[],
  projectId?: string,
  kind: ApiKeyKind = "standard",
): Promise<CreatedApiKey> {
  return request<CreatedApiKey>("/api/keys", { method: "POST", body: { name, scopes, projectId, kind } });
}

export function revokeApiKey(keyId: string): Promise<void> {
  return request<void>(`/api/keys/${keyId}`, { method: "DELETE" });
}
