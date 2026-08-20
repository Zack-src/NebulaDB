import type { Project } from "@athanordb/shared";
import type { PermissionLevel, ProjectStatus, ProjectSummary, ProjectTeamGrant } from "@/types";
import { request, requestText } from "./httpClient";
import type { SqlDialect } from "./convertApi";

export interface RevisionSummary {
  id: string;
  createdAt: string;
  author: string | null;
  label: string | null;
}

const projectPath = (projectId: string) => `/api/projects/${projectId}`;

// --- the project itself ---

export function fetchProjects(): Promise<ProjectSummary[]> {
  return request<ProjectSummary[]>("/api/projects");
}

export function fetchProject(projectId: string): Promise<ProjectSummary> {
  return request<ProjectSummary>(projectPath(projectId));
}

export function createProject(name: string): Promise<ProjectSummary> {
  return request<ProjectSummary>("/api/projects", { method: "POST", body: { name } });
}

export function renameProject(projectId: string, name: string): Promise<ProjectSummary> {
  return request<ProjectSummary>(projectPath(projectId), { method: "PATCH", body: { name } });
}

export function setProjectStatus(projectId: string, status: ProjectStatus): Promise<ProjectSummary> {
  return request<ProjectSummary>(projectPath(projectId), { method: "PATCH", body: { status } });
}

export function deleteProjectForever(projectId: string): Promise<void> {
  return request<void>(projectPath(projectId), { method: "DELETE" });
}

// --- team access ---

export function fetchProjectTeams(projectId: string): Promise<ProjectTeamGrant[]> {
  return request<ProjectTeamGrant[]>(`${projectPath(projectId)}/teams`);
}

export function grantProjectTeam(
  projectId: string,
  teamId: string,
  permission: PermissionLevel,
): Promise<ProjectTeamGrant> {
  return request<ProjectTeamGrant>(`${projectPath(projectId)}/teams/${teamId}`, {
    method: "PUT",
    body: { permission },
  });
}

export function revokeProjectTeam(projectId: string, teamId: string): Promise<void> {
  return request<void>(`${projectPath(projectId)}/teams/${teamId}`, { method: "DELETE" });
}

// --- history ---

export function fetchRevisions(projectId: string): Promise<RevisionSummary[]> {
  return request<RevisionSummary[]>(`${projectPath(projectId)}/revisions`);
}

export function fetchRevisionProject(projectId: string, revisionId: string): Promise<Project> {
  return request<Project>(`${projectPath(projectId)}/revisions/${revisionId}`);
}

export function labelRevision(projectId: string, revisionId: string, label: string | null): Promise<void> {
  return request<void>(`${projectPath(projectId)}/revisions/${revisionId}`, { method: "PATCH", body: { label } });
}

export function restoreRevision(projectId: string, revisionId: string): Promise<void> {
  return request<void>(`${projectPath(projectId)}/revisions/${revisionId}/restore`, { method: "POST" });
}

// --- import / export ---

/**
 * `baseline` is the text `source` was derived from — sent by the DBML panel's
 * auto-sync so the server can tell "the user deleted this" from "the user
 * never saw this" and keep whatever a collaborator added while this buffer
 * was open (see `preserveConcurrentAdditions` server-side). Omitted by
 * one-shot imports, where replacing everything is the point.
 */
export function importSource(
  projectId: string,
  source: string,
  dialect?: SqlDialect,
  baseline?: string,
): Promise<{ tables: number }> {
  return request<{ tables: number }>(`${projectPath(projectId)}/import`, {
    method: "POST",
    body: {
      source,
      ...(dialect ? { dialect } : {}),
      ...(baseline ? { baseline } : {}),
    },
  });
}

export function exportDbml(projectId: string, includeVisualMetadata = false): Promise<string> {
  return requestText(`${projectPath(projectId)}/export/dbml`, {
    query: { visual: includeVisualMetadata ? "1" : undefined },
  });
}

export function exportSql(projectId: string, dialect: SqlDialect): Promise<string> {
  return requestText(`${projectPath(projectId)}/export/sql`, { query: { dialect } });
}

export function exportRevisionDbml(projectId: string, revisionId: string): Promise<string> {
  return requestText(`${projectPath(projectId)}/revisions/${revisionId}/export/dbml`);
}
