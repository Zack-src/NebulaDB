import { request } from "./httpClient";

/** What a share link opens: the diagram, the data dictionary, or both. */
export type ShareContent = "diagram" | "dictionary" | "both";
export type ShareLinkStatus = "active" | "expired" | "revoked";

export interface ShareLink {
  id: string;
  projectId: string;
  label: string;
  /** The first characters of the token — an instance administrator can reveal the rest from the admin console. */
  tokenPrefix: string;
  /** Whether an instance administrator can copy the full address again (links made before it was kept cannot). */
  copyable: boolean;
  shows: ShareContent;
  status: ShareLinkStatus;
  createdAt: string;
  createdByName: string | null;
  expiresAt: string;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
}

export interface InstanceShareLink extends ShareLink {
  projectName: string;
}

/** `enabled` — whether the instance allows share links at all; off, existing links stop working. */
export interface ShareLinkList<T extends ShareLink = ShareLink> {
  enabled: boolean;
  links: T[];
}

const base = (projectId: string) => `/api/projects/${projectId}/share-links`;

export function fetchShareLinks(projectId: string): Promise<ShareLinkList> {
  return request<ShareLinkList>(base(projectId));
}

/** `token` is only ever returned here. */
export function createShareLink(
  projectId: string,
  input: { label: string; shows: ShareContent; expiresInDays: number },
): Promise<{ link: ShareLink; token: string }> {
  return request<{ link: ShareLink; token: string }>(base(projectId), { method: "POST", body: input });
}

export function revokeShareLink(projectId: string, id: string): Promise<{ link: ShareLink }> {
  return request<{ link: ShareLink }>(`${base(projectId)}/${id}`, { method: "DELETE" });
}

export function fetchAllShareLinks(): Promise<ShareLinkList<InstanceShareLink>> {
  return request<ShareLinkList<InstanceShareLink>>("/api/admin/share-links");
}

export function revokeAnyShareLink(id: string): Promise<{ link: ShareLink }> {
  return request<{ link: ShareLink }>(`/api/admin/share-links/${id}`, { method: "DELETE" });
}

export async function setShareLinksEnabled(enabled: boolean): Promise<boolean> {
  return (await request<{ enabled: boolean }>("/api/admin/settings/share-links", { method: "PUT", body: { enabled } }))
    .enabled;
}

/** The address a token opens — what the person who created the link sends on. */
export function shareUrl(token: string, origin = window.location.origin): string {
  return `${origin}/share/${token}`;
}

/** An instance administrator's request for a working link's full token, to copy its address again; audited. */
export async function revealShareLink(id: string): Promise<{ token: string }> {
  return request<{ token: string }>(`/api/admin/share-links/${id}/reveal`, { method: "POST" });
}
