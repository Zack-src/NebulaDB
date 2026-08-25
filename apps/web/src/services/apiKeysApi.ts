import { request } from "./httpClient";

export type ApiKeyScope =
  "projects:read" | "projects:write" | "deployments:trigger" | "connections:manage" | "teams:manage";

export const API_KEY_SCOPES: ApiKeyScope[] = [
  "projects:read",
  "projects:write",
  "deployments:trigger",
  "connections:manage",
  "teams:manage",
];

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

export interface CreatedApiKey {
  summary: ApiKeySummary;
  /** The full key — shown once, at creation, and never retrievable again. */
  plaintextKey: string;
}

export function listApiKeys(): Promise<ApiKeySummary[]> {
  return request<{ keys: ApiKeySummary[] }>("/api/keys").then((res) => res.keys);
}

export function createApiKey(name: string, scopes: ApiKeyScope[], projectId?: string): Promise<CreatedApiKey> {
  return request<CreatedApiKey>("/api/keys", { method: "POST", body: { name, scopes, projectId } });
}

export function revokeApiKey(keyId: string): Promise<void> {
  return request<void>(`/api/keys/${keyId}`, { method: "DELETE" });
}
