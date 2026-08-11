import { useCallback, useEffect, useState } from "react";
import { describeApiError } from "@/i18n/serverErrorMessages";
import { useTranslation } from "@/i18n/useTranslation";
import * as projectsApi from "@/services/projectsApi";
import type { ProjectStatus, ProjectSummary } from "@/types";

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
  renameProject: (project: ProjectSummary, name: string) => Promise<void>;
  setProjectStatus: (project: ProjectSummary, status: ProjectStatus) => Promise<void>;
  deleteProjectForever: (project: ProjectSummary) => Promise<string | null>;
  emptyTrash: (items: ProjectSummary[]) => Promise<string | null>;
}

/** Stable empty array, so a logged-out render doesn't hand consumers a new identity every time. */
const EMPTY_PROJECTS: ProjectSummary[] = [];

/** Owns the project-list CRUD calls; `active` gates the initial fetch on being logged in. */
export function useProjects(active: boolean): ProjectsHandle {
  const { t } = useTranslation();
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
    projectsApi
      .fetchProjects()
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
      const created = await projectsApi.createProject(name);
      refreshProjects();
      return { id: created.id };
    } catch (err) {
      return { error: describeApiError(err, t) };
    }
  };

  const renameProject = async (project: ProjectSummary, name: string) => {
    await projectsApi.renameProject(project.id, name);
    refreshProjects();
  };

  const setProjectStatus = async (project: ProjectSummary, status: ProjectStatus) => {
    await projectsApi.setProjectStatus(project.id, status);
    refreshProjects();
  };

  const deleteProjectForever = async (project: ProjectSummary): Promise<string | null> => {
    try {
      await projectsApi.deleteProjectForever(project.id);
      refreshProjects();
      return null;
    } catch (err) {
      return describeApiError(err, t);
    }
  };

  const emptyTrash = async (items: ProjectSummary[]): Promise<string | null> => {
    // `allSettled`, not `all`: one project failing to delete must not abandon
    // the rest, and the user is told how many survived.
    const outcomes = await Promise.allSettled(items.map((item) => projectsApi.deleteProjectForever(item.id)));
    refreshProjects();
    const failed = outcomes.filter((outcome) => outcome.status === "rejected").length;
    return failed > 0 ? t("projects.emptyTrashPartialFailure", { count: failed }) : null;
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
