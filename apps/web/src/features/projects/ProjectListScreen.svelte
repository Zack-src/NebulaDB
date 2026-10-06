<script lang="ts">
  import NotificationBell from "@/features/notifications/NotificationBell.svelte";
  import ProjectList from "@/features/projects/ProjectList.svelte";
  import Navbar from "@/components/layout/Navbar.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import { APP_SHELL } from "@/components/ui/layout";
  import type { CreateProjectResult } from "@/features/projects/projects.svelte";
  import type { SearchHit } from "@/services/searchApi";
  import type { CreateProjectFromDatabaseResponse } from "@/services/connectionsApi";
  import type { ProjectStatus, ProjectSummary, Session } from "@/types/index";

  let props: {
    session: Session;
    embedded?: boolean;
    projects: ProjectSummary[];
    /** False until the first project fetch settles — the list shows placeholders rather than an empty state. */
    projectsLoaded: boolean;
    openLinkError: string | null;
    onOpenProject: (p: ProjectSummary) => void;
    onOpenAdmin: () => void;
    onOpenSettings?: () => void;
    /** Opens a project known only by its id — where a notification leads. */
    onOpenProjectById?: (projectId: string) => void;
    onLogout: () => void;
    onCreateProject: (name: string) => Promise<CreateProjectResult>;
    onOpenSearchHit: (hit: SearchHit) => void;
    onRenameProject: (p: ProjectSummary, name: string) => Promise<void>;
    onSetProjectStatus: (p: ProjectSummary, status: ProjectStatus) => Promise<void>;
    onDeleteProjectForever: (p: ProjectSummary) => Promise<string | null>;
    onEmptyTrash: (items: ProjectSummary[]) => Promise<string | null>;
    onProjectCreatedFromDatabase: (result: CreateProjectFromDatabaseResponse) => void;
  } = $props();
</script>

<div class={props.embedded ? "flex min-h-0 min-w-0 flex-1 flex-col bg-bg" : APP_SHELL}>
  {#if !props.embedded}
    <Navbar
      session={props.session}
      onOpenSettings={props.onOpenSettings}
      onOpenAdmin={props.onOpenAdmin}
      onLogout={props.onLogout}
    >
      {#snippet actions()}
        <NotificationBell onOpenProject={props.onOpenProjectById} />
      {/snippet}
    </Navbar>
  {/if}

  {#if props.openLinkError}
    <div class="p-4">
      <ErrorText>{props.openLinkError}</ErrorText>
    </div>
  {/if}

  <div class="min-h-0 flex-1">
    <ProjectList
      projects={props.projects}
      loaded={props.projectsLoaded}
      onCreateProject={props.onCreateProject}
      onOpen={props.onOpenProject}
      onOpenSearchHit={props.onOpenSearchHit}
      onRename={props.onRenameProject}
      onSetStatus={props.onSetProjectStatus}
      onDeleteForever={props.onDeleteProjectForever}
      onEmptyTrash={props.onEmptyTrash}
      onProjectCreatedFromDatabase={props.onProjectCreatedFromDatabase}
    />
  </div>
</div>
