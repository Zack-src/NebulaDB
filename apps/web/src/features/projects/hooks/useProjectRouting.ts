import { useEffect, useState } from "react";
import { useTranslation } from "@/i18n/useTranslation";
import { ApiError } from "@/services/ApiError";
import { fetchProject } from "@/services/projectsApi";
import type { ProjectSummary, Session } from "@/types";

export interface ProjectRoutingHandle {
  inviteToken: string | null;
  initialProjectId: string | null;
  openProject: ProjectSummary | null;
  openLinkError: string | null;
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
  session: Session | null | "loading",
  projects: ProjectSummary[],
): ProjectRoutingHandle {
  const { t } = useTranslation();
  const [inviteToken] = useState(() => location.pathname.match(INVITE_PATH)?.[1] ?? null);
  const [initialProjectId] = useState(projectIdFromLocation);
  const [openProjectState, setOpenProject] = useState<ProjectSummary | null>(null);
  const [openLinkError, setOpenLinkError] = useState<string | null>(null);

  /**
   * Logging out closes whatever was open. Derived from the session rather than
   * cleared by the logout callback: it used to be `routing.reset()` called from
   * `useAuthSession`'s handler in `App`, which meant `App` referenced `routing`
   * on a line above its own declaration.
   */
  const loggedIn = Boolean(session) && session !== "loading";
  const openProject = loggedIn ? openProjectState : null;

  const openProjectAndNavigate = (project: ProjectSummary) => {
    setOpenLinkError(null);
    setOpenProject(project);
    history.pushState(null, "", `/project/${project.id}`);
  };

  const closeProject = () => {
    setOpenProject(null);
    history.pushState(null, "", "/");
  };

  // Resolves a deep-linked `/project/:id` once we know who's logged in — the
  // project-list fetch races this, so this asks the server directly rather
  // than waiting on it (and the endpoint enforces permission either way).
  useEffect(() => {
    if (!initialProjectId || !session || session === "loading" || openProject) return;
    fetchProject(initialProjectId)
      .then(setOpenProject)
      .catch((err: unknown) => {
        history.replaceState(null, "", "/");
        const missing = err instanceof ApiError && err.status === 404;
        setOpenLinkError(t(missing ? "projects.linkGone" : "projects.linkForbidden"));
      });
    // `openProject` is deliberately excluded: it is set by this very effect,
    // and including it would re-run the resolution against its own result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProjectId, session, t]);

  // Mirrors browser back/forward on `/project/:id` <-> `/` to in-memory state.
  useEffect(() => {
    const handlePopState = () => {
      const id = projectIdFromLocation();
      if (!id) {
        setOpenProject(null);
        return;
      }
      const alreadyListed = projects.find((project) => project.id === id);
      if (alreadyListed) {
        setOpenProject(alreadyListed);
        return;
      }
      fetchProject(id)
        .then(setOpenProject)
        .catch(() => setOpenProject(null));
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [projects]);

  useEffect(() => {
    document.title = openProject ? `${openProject.name} · AthanorDB` : "AthanorDB";
  }, [openProject]);

  return { inviteToken, initialProjectId, openProject, openLinkError, openProjectAndNavigate, closeProject };
}
