import { untrack } from "svelte";
import { useTranslation } from "@/i18n/i18n.svelte";
import { ApiError } from "@/services/ApiError";
import { fetchProject } from "@/services/projectsApi";
import type { ProjectSummary, Session } from "@/types";

/**
 * The sections of a project's workspace. `schema` is the editor itself and
 * has no URL segment; the others are `/project/:id/<tab>`, so a tab can be
 * linked to, reloaded and reached with back / forward.
 */
export type WorkspaceTab = "schema" | "deployments" | "history" | "problems" | "dictionary";

const TAB_SEGMENTS: readonly WorkspaceTab[] = ["deployments", "history", "problems", "dictionary"];

/** Where to centre the canvas once a project opens — set by a cross-project search hit. */
export interface CanvasFocusTarget {
  tableName: string;
  fieldName?: string;
}

export interface ProjectRoutingHandle {
  readonly inviteToken: string | null;
  /** Token from an emailed `/reset-password/:token` link, read once at mount like `inviteToken`. */
  readonly resetToken: string | null;
  readonly initialProjectId: string | null;
  readonly openProject: ProjectSummary | null;
  readonly openLinkError: string | null;
  /** Consumed by the editor on mount; cleared on the next plain open so it never re-applies to another project. */
  readonly focusTarget: CanvasFocusTarget | null;
  /** The workspace tab the URL names; the editor falls back to `schema` when the user may not see it. */
  readonly tab: WorkspaceTab;
  setTab: (tab: WorkspaceTab) => void;
  openProjectAndNavigate: (project: ProjectSummary, focus?: CanvasFocusTarget) => void;
  /** Same, from an id alone (a search hit) — uses the loaded list when it can, the API otherwise. */
  openProjectById: (projectId: string, focus?: CanvasFocusTarget) => void;
  closeProject: () => void;
}

const INVITE_PATH = /^\/invite\/([^/]+)$/;
const RESET_PATH = /^\/reset-password\/([^/]+)$/;
const PROJECT_PATH = /^\/project\/([^/]+)(?:\/([a-z]+))?$/;

const projectIdFromLocation = () => location.pathname.match(PROJECT_PATH)?.[1] ?? null;

function tabFromLocation(): WorkspaceTab {
  const segment = location.pathname.match(PROJECT_PATH)?.[2];
  return TAB_SEGMENTS.find((tab) => tab === segment) ?? "schema";
}

/**
 * `/project/:id?table=orders&field=note` — a link that opens a project on one
 * table. Used where the app's own navigation state is out of reach (the
 * database console sending a structural change to the schema).
 */
function focusFromLocation(): CanvasFocusTarget | null {
  const query = new URLSearchParams(location.search);
  const tableName = query.get("table");
  return tableName ? { tableName, fieldName: query.get("field") ?? undefined } : null;
}

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
  const resetToken = location.pathname.match(RESET_PATH)?.[1] ?? null;
  const initialProjectId = projectIdFromLocation();
  let openProjectState = $state.raw<ProjectSummary | null>(null);
  let openLinkError = $state<string | null>(null);
  let focusTarget = $state.raw<CanvasFocusTarget | null>(initialProjectId ? focusFromLocation() : null);
  let tab = $state<WorkspaceTab>(tabFromLocation());

  /**
   * Logging out closes whatever was open. Derived from the session rather than
   * cleared by the logout callback, so there is exactly one place deciding it.
   */
  const openProject = $derived.by(() => {
    const current = session();
    return current && current !== "loading" ? openProjectState : null;
  });

  const openProjectAndNavigate = (project: ProjectSummary, focus?: CanvasFocusTarget) => {
    openLinkError = null;
    focusTarget = focus ?? null;
    tab = "schema";
    openProjectState = project;
    history.pushState(null, "", `/project/${project.id}`);
  };

  const setTab = (next: WorkspaceTab) => {
    const id = openProjectState?.id;
    if (!id || next === tab) return;
    tab = next;
    history.pushState(null, "", next === "schema" ? `/project/${id}` : `/project/${id}/${next}`);
  };

  const openProjectById = (projectId: string, focus?: CanvasFocusTarget) => {
    const listed = projects().find((project) => project.id === projectId);
    if (listed) {
      openProjectAndNavigate(listed, focus);
      return;
    }
    fetchProject(projectId)
      .then((project) => openProjectAndNavigate(project, focus))
      .catch(() => {
        openLinkError = t("projects.linkForbidden");
      });
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
      // A search hit's focus belongs to the open it came with, not to history navigation.
      focusTarget = null;
      tab = tabFromLocation();
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
    resetToken,
    initialProjectId,
    get openProject() {
      return openProject;
    },
    get openLinkError() {
      return openLinkError;
    },
    get focusTarget() {
      return focusTarget;
    },
    get tab() {
      return tab;
    },
    setTab,
    openProjectAndNavigate,
    openProjectById,
    closeProject,
  };
}
