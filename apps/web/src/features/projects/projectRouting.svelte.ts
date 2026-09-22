import { untrack } from "svelte";
import { useTranslation } from "@/i18n/i18n.svelte";
import { ApiError } from "@/services/ApiError";
import { fetchProject } from "@/services/projectsApi";
import type { ProjectSummary, Session } from "@/types";

export interface ProjectRoutingHandle {
  readonly inviteToken: string | null;
  readonly initialProjectId: string | null;
  readonly openProject: ProjectSummary | null;
  readonly openLinkError: string | null;
  openProjectAndNavigate: (project: ProjectSummary) => void;
  closeProject: () => void;
}

const INVITE_PATH = /^\/invite\/([^/]+)$/;
const PROJECT_PATH = /^\/project\/([^/]+)$/;

const projectIdFromLocation = () => location.pathname.match(PROJECT_PATH)?.[1] ?? null;

/**
 * Owns the app's "no router" URL sync: `/invite/:token` and `/project/:id`
 * are the only paths treated as real URLs (read once at mount), everything
 * else is in-memory state pushed/replaced into `history` so a bookmarked or
 * shared project link still works and back/forward behaves as expected.
 */
export function useProjectRouting(
  session: () => Session | null | "loading",
  projects: () => ProjectSummary[],
): ProjectRoutingHandle {
  const { t } = useTranslation();
  const inviteToken = location.pathname.match(INVITE_PATH)?.[1] ?? null;
  const initialProjectId = projectIdFromLocation();
  let openProjectState = $state.raw<ProjectSummary | null>(null);
  let openLinkError = $state<string | null>(null);

  /**
   * Logging out closes whatever was open. Derived from the session rather than
   * cleared by the logout callback, so there is exactly one place deciding it.
   */
  const openProject = $derived.by(() => {
    const current = session();
    return current && current !== "loading" ? openProjectState : null;
  });

  const openProjectAndNavigate = (project: ProjectSummary) => {
    openLinkError = null;
    openProjectState = project;
    history.pushState(null, "", `/project/${project.id}`);
  };

  const closeProject = () => {
    openProjectState = null;
    history.pushState(null, "", "/");
  };

  // Resolves a deep-linked `/project/:id` once we know who's logged in — the
  // project-list fetch races this, so this asks the server directly rather
  // than waiting on it (and the endpoint enforces permission either way).
  $effect(() => {
    const current = session();
    if (!initialProjectId || !current || current === "loading" || untrack(() => openProject)) return;
    fetchProject(initialProjectId)
      .then((project) => {
        openProjectState = project;
      })
      .catch((err: unknown) => {
        history.replaceState(null, "", "/");
        const missing = err instanceof ApiError && err.status === 404;
        openLinkError = t(missing ? "projects.linkGone" : "projects.linkForbidden");
      });
  });

  // Mirrors browser back/forward on `/project/:id` <-> `/` to in-memory state.
  $effect(() => {
    const handlePopState = () => {
      const id = projectIdFromLocation();
      if (!id) {
        openProjectState = null;
        return;
      }
      const alreadyListed = projects().find((project) => project.id === id);
      if (alreadyListed) {
        openProjectState = alreadyListed;
        return;
      }
      fetchProject(id)
        .then((project) => {
          openProjectState = project;
        })
        .catch(() => {
          openProjectState = null;
        });
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  });

  $effect(() => {
    document.title = openProject ? `${openProject.name} · AthanorDB` : "AthanorDB";
  });

  return {
    inviteToken,
    initialProjectId,
    get openProject() {
      return openProject;
    },
    get openLinkError() {
      return openLinkError;
    },
    openProjectAndNavigate,
    closeProject,
  };
}
