import { ProjectList } from "./ProjectList.js";
import { Navbar } from "./Navbar.js";
import { ErrorText } from "./ui/Alert.js";
import { APP_SHELL } from "./ui/layout.js";
import type { CreateProjectResult } from "./hooks/useProjects.js";
import type { ProjectStatus, ProjectSummary, Session } from "./types.js";

export interface ProjectListScreenProps {
  session: Session;
  serverStatus: "checking" | "ok" | "down";
  projects: ProjectSummary[];
  /** False until the first project fetch settles — the list shows placeholders rather than an empty state. */
  projectsLoaded: boolean;
  openLinkError: string | null;
  onOpenProject: (p: ProjectSummary) => void;
  onOpenAdmin: () => void;
  onOpenSettings?: () => void;
  onLogout: () => void;
  onDisplayNameChange: (name: string) => void;
  onCreateProject: (name: string) => Promise<CreateProjectResult>;
  onRenameProject: (p: ProjectSummary, name: string) => Promise<void>;
  onSetProjectStatus: (p: ProjectSummary, status: ProjectStatus) => Promise<void>;
  onDeleteProjectForever: (p: ProjectSummary) => Promise<string | null>;
  onEmptyTrash: (items: ProjectSummary[]) => Promise<string | null>;
}

export function ProjectListScreen(props: ProjectListScreenProps) {
  return (
    <div className={APP_SHELL}>
      <Navbar
        session={props.session}
        serverStatus={props.serverStatus}
        onOpenSettings={props.onOpenSettings}
        onOpenAdmin={props.onOpenAdmin}
        onLogout={props.onLogout}
      />

      {props.openLinkError && (
        <div className="p-4">
          <ErrorText>{props.openLinkError}</ErrorText>
        </div>
      )}

      <div className="min-h-0 flex-1">
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
  );
}
