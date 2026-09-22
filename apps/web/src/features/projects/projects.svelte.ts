import { describeApiError } from "@/i18n/serverErrorMessages";
import { useTranslation } from "@/i18n/i18n.svelte";
import * as projectsApi from "@/services/projectsApi";
import type { ProjectStatus, ProjectSummary } from "@/types";

export type CreateProjectResult = { id: string } | { error: string };

export interface ProjectsHandle {
  readonly projects: ProjectSummary[];
  /**
   * False until the first fetch has come back. Without it, callers can't tell
   * "no projects" from "not loaded yet" — both are an empty array — and the
   * dashboard told a user with projects that they had none for as long as the
   * request took.
   */
  readonly loaded: boolean;
  refreshProjects: () => void;
  createProject: (name: string) => Promise<CreateProjectResult>;
  renameProject: (project: ProjectSummary, name: string) => Promise<void>;
  setProjectStatus: (project: ProjectSummary, status: ProjectStatus) => Promise<void>;
  deleteProjectForever: (project: ProjectSummary) => Promise<string | null>;
  emptyTrash: (items: ProjectSummary[]) => Promise<string | null>;
}

/** Stable empty array, so a logged-out read doesn't hand consumers a new identity every time. */
const EMPTY_PROJECTS: ProjectSummary[] = [];

/** Owns the project-list CRUD calls; `active()` gates the initial fetch on being logged in. */
export function useProjects(active: () => boolean): ProjectsHandle {
  const { t } = useTranslation();
  // A boolean of its own, so a new session object for the same login (a
  // display-name change) doesn't count as a login transition below.
  const isActive = $derived(active());
  let fetched = $state.raw<ProjectSummary[]>([]);
  let fetchSettled = $state(false);

  const refreshProjects = () => {
    projectsApi
      .fetchProjects()
      .then((list) => {
        fetched = list;
      })
      .catch(() => {})
      // Settled, not succeeded: a failed fetch must still stop the placeholder,
      // or a server that's down leaves the dashboard loading forever.
      .finally(() => {
        fetchSettled = true;
      });
  };

  // Reset and refetch on every login/logout transition. Without the reset,
  // logging out and back in — as a different account, say — showed the
  // previous account's project list until the new fetch replaced it, and
  // `loaded` stayed true throughout so the placeholder never appeared either.
  // Stale data belonging to another user is a worse failure than a slow list.
  $effect.pre(() => {
    const loggedIn = isActive;
    fetched = [];
    fetchSettled = false;
    if (loggedIn) refreshProjects();
  });

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
    // Logged out -> no projects, derived rather than cleared: the fetched list
    // is simply not shown, and it is refetched on the next login.
    get projects() {
      return isActive ? fetched : EMPTY_PROJECTS;
    },
    get loaded() {
      return isActive && fetchSettled;
    },
    refreshProjects,
    createProject,
    renameProject,
    setProjectStatus,
    deleteProjectForever,
    emptyTrash,
  };
}
