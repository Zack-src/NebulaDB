import type { ProjectFolder } from "@nebuladb/shared";
import type { ProjectDiff, VariantDecisions, VariantSyncPlan } from "@nebuladb/dbml-engine";
import type { ProjectSummary } from "@/types";
import { request } from "./httpClient";

// --- folders of the project list ---

export async function fetchFolders(): Promise<ProjectFolder[]> {
  return (await request<{ folders: ProjectFolder[] }>("/api/project-folders")).folders;
}

export async function createFolder(name: string, parentId: string | null): Promise<ProjectFolder> {
  return (
    await request<{ folder: ProjectFolder }>("/api/project-folders", { method: "POST", body: { name, parentId } })
  ).folder;
}

export async function updateFolder(
  id: string,
  changes: { name?: string; parentId?: string | null },
): Promise<ProjectFolder> {
  return (await request<{ folder: ProjectFolder }>(`/api/project-folders/${id}`, { method: "PATCH", body: changes }))
    .folder;
}

export function deleteFolder(id: string): Promise<{ movedProjects: number; movedFolders: number }> {
  return request(`/api/project-folders/${id}`, { method: "DELETE" });
}

export function moveProjectToFolder(projectId: string, folderId: string | null): Promise<{ folderId: string | null }> {
  return request(`/api/projects/${projectId}/folder`, { method: "PUT", body: { folderId } });
}

// --- client variants ---

export interface VariantStatus {
  pending: number;
  conflicts: number;
  customizations: number;
}

export interface VariantEntry {
  id: string;
  name: string;
  syncedAt: string;
  syncedByName: string | null;
  canEdit: boolean;
  /** May rename, trash or detach it. */
  canManage: boolean;
  status: VariantStatus;
}

export interface VariantOriginal {
  id: string;
  /** `null` when the caller may not see the original. */
  name: string | null;
  canView: boolean;
  syncedAt: string;
  syncedByName: string | null;
  status: VariantStatus | null;
}

export function fetchVariants(
  projectId: string,
): Promise<{ variants: VariantEntry[]; original: VariantOriginal | null }> {
  return request(`/api/projects/${projectId}/variants`);
}

export function createVariant(projectId: string, name: string): Promise<ProjectSummary> {
  return request(`/api/projects/${projectId}/variants`, { method: "POST", body: { name } });
}

/** `push`: the original's changes go to the variants. `pull`: the variants' go to the original. */
export type VariantSyncDirection = "push" | "pull";

export interface VariantSyncOptions {
  direction?: VariantSyncDirection;
  /** Column properties left as the receiving side has them (`type` for a variant on another engine). */
  ignoreFieldProps?: string[];
}

export async function previewVariantSync(
  originalId: string,
  variantIds: string[],
  options: VariantSyncOptions = {},
): Promise<{ id: string; name: string; plan: VariantSyncPlan }[]> {
  return (
    await request<{ variants: { id: string; name: string; plan: VariantSyncPlan }[] }>(
      `/api/projects/${originalId}/variants/preview`,
      { method: "POST", body: { variants: variantIds, ...options } },
    )
  ).variants;
}

export interface VariantSyncResult {
  id: string;
  name: string;
  applied: number;
  kept: number;
  error?: string;
}

export async function pushToVariants(
  originalId: string,
  targets: { id: string; decisions: VariantDecisions }[],
  options: VariantSyncOptions = {},
): Promise<VariantSyncResult[]> {
  return (
    await request<{ results: VariantSyncResult[] }>(`/api/projects/${originalId}/variants/push`, {
      method: "POST",
      body: { variants: targets, ...options },
    })
  ).results;
}

export function detachVariant(projectId: string): Promise<void> {
  return request(`/api/projects/${projectId}/variant`, { method: "DELETE" });
}

/** What `otherId` has differently from `projectId`. */
export async function compareProjects(projectId: string, otherId: string): Promise<ProjectDiff> {
  return (await request<{ diff: ProjectDiff }>(`/api/projects/${projectId}/compare/${otherId}`)).diff;
}

/** `from`: `"original"`, or another variant of the same original. */
export function resetVariant(projectId: string, from: string): Promise<{ reset: true; from: string }> {
  return request(`/api/projects/${projectId}/variant/reset`, { method: "POST", body: { from } });
}

export interface ProjectFamily {
  originalId: string;
  members: { id: string; name: string; original: boolean }[];
}

/** The original and its variants the caller can see; `null` for a project without any. */
export async function fetchFamily(projectId: string): Promise<ProjectFamily | null> {
  return (await request<{ family: ProjectFamily | null }>(`/api/projects/${projectId}/family`)).family;
}
