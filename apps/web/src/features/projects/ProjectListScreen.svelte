<script lang="ts">
  import ProjectList from "@/features/projects/ProjectList.svelte";
  import Navbar from "@/components/layout/Navbar.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import { APP_SHELL } from "@/components/ui/layout";
  import type { CreateProjectResult } from "@/features/projects/projects.svelte";
  import type { ProjectTemplateId } from "@athanordb/dbml-engine";
  import type { ProjectStatus, ProjectSummary, Session } from "@/types/index";

  let props: {
    session: Session;
    projects: ProjectSummary[];
    /** False until the first project fetch settles — the list shows placeholders rather than an empty state. */
    projectsLoaded: boolean;
    openLinkError: string | null;
    onOpenProject: (p: ProjectSummary) => void;
    onOpenAdmin: () => void;
    onOpenSettings?: () => void;
    onLogout: () => void;
    onCreateProject: (name: string, template?: ProjectTemplateId) => Promise<CreateProjectResult>;
    onRenameProject: (p: ProjectSummary, name: string) => Promise<void>;
    onSetProjectStatus: (p: ProjectSummary, status: ProjectStatus) => Promise<void>;
    onDeleteProjectForever: (p: ProjectSummary) => Promise<string | null>;
    onEmptyTrash: (items: ProjectSummary[]) => Promise<string | null>;
  } = $props();
</script>

<div class={APP_SHELL}>
  <Navbar
    session={props.session}
    onOpenSettings={props.onOpenSettings}
    onOpenAdmin={props.onOpenAdmin}
    onLogout={props.onLogout}
  />

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
      onRename={props.onRenameProject}
      onSetStatus={props.onSetProjectStatus}
      onDeleteForever={props.onDeleteProjectForever}
      onEmptyTrash={props.onEmptyTrash}
    />
  </div>
</div>
