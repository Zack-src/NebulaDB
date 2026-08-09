import { useCallback, useEffect, useState } from "react";
import type { ProjectStatus, ProjectSummary } from "../types.js";

export type CreateProjectResult = { id: string } | { error: string };

export interface ProjectsHandle {
  projects: ProjectSummary[];
  /**
   * False until the first fetch has come back. Without it, callers can't tell
   * "no projects" from "not loaded yet" — both are an empty array — and the
   * dashboard told a user with projects that they had none for as long as the
   * request took.
   */
  loaded: boolean;
  refreshProjects: () => void;
  createProject: (name: string) => Promise<CreateProjectResult>;
  renameProject: (p: ProjectSummary, name: string) => Promise<void>;
  setProjectStatus: (p: ProjectSummary, status: ProjectStatus) => Promise<void>;
  deleteProjectForever: (p: ProjectSummary) => Promise<string | null>;
  emptyTrash: (items: ProjectSummary[]) => Promise<string | null>;
}

/** Stable empty array, so a logged-out render doesn't hand consumers a new identity every time. */
const EMPTY_PROJECTS: ProjectSummary[] = [];

/** Owns the project-list CRUD calls; `active` gates the initial fetch on being logged in. */
export function useProjects(active: boolean): ProjectsHandle {
  const [fetched, setFetched] = useState<ProjectSummary[]>([]);
  const [fetchSettled, setFetchSettled] = useState(false);
  const [lastActive, setLastActive] = useState(active);

  // Reset on every login/logout transition, adjusted *during render* (React's
  // documented pattern) rather than from an effect, so there is no committed
  // frame showing the wrong thing.
  //
  // Without this, logging out and back in — as a different account, say —
  // rendered the previous account's project list from the still-populated
  // state until the new fetch replaced it, and `loaded` stayed true throughout
  // so the placeholder never appeared either. Stale data belonging to another
  // user is a worse failure than a slow list.
  if (lastActive !== active) {
    setLastActive(active);
    setFetched([]);
    setFetchSettled(false);
  }

  const refreshProjects = useCallback(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then(setFetched)
      .catch(() => {})
      // Settled, not succeeded: a failed fetch must still stop the placeholder,
      // or a server that's down leaves the dashboard loading forever.
      .finally(() => setFetchSettled(true));
  }, []);

  useEffect(() => {
    if (active) refreshProjects();
  }, [active, refreshProjects]);

  // Logged out -> no projects, derived rather than cleared from an effect: the
  // fetched list is simply not shown, and it is refetched on the next login.
  const projects = active ? fetched : EMPTY_PROJECTS;
  const loaded = active && fetchSettled;

  const createProject = async (name: string): Promise<CreateProjectResult> => {
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        refreshProjects();
        return { id: data.id as string };
      }
      return { error: data.error ?? `Create failed (${res.status})` };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Network error" };
    }
  };

  const renameProject = async (p: ProjectSummary, name: string) => {
    const res = await fetch(`/api/projects/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) refreshProjects();
  };

  const setProjectStatus = async (p: ProjectSummary, status: ProjectStatus) => {
    const res = await fetch(`/api/projects/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) refreshProjects();
  };

  const deleteProjectForever = async (p: ProjectSummary): Promise<string | null> => {
    const res = await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
    if (res.ok) {
      refreshProjects();
      return null;
    }
    const data = await res.json().catch(() => ({}));
    return data.error ?? `Delete failed (${res.status})`;
  };

  const emptyTrash = async (items: ProjectSummary[]): Promise<string | null> => {
    const results = await Promise.all(items.map((p) => fetch(`/api/projects/${p.id}`, { method: "DELETE" })));
    refreshProjects();
    const failedCount = results.filter((r) => !r.ok).length;
    return failedCount > 0 ? `${failedCount} project(s) could not be deleted.` : null;
  };

  return {
    projects,
    loaded,
    refreshProjects,
    createProject,
    renameProject,
    setProjectStatus,
    deleteProjectForever,
    emptyTrash,
  };
}
