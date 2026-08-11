import { useState } from "react";
import "@xyflow/react/dist/style.css";
import { useAuthSession } from "./hooks/useAuthSession.js";
import { useProjects } from "./hooks/useProjects.js";
import { useProjectRouting } from "./hooks/useProjectRouting.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { ProjectEditor } from "./ProjectEditor.js";
import { ProjectListScreen } from "./ProjectListScreen.js";
import { Login } from "./Login.js";
import { SettingsPage } from "./SettingsPage.js";
import { AcceptInvite } from "./AcceptInvite.js";
import { AdminConsole } from "./AdminConsole.js";
import { APP_SHELL } from "./ui/layout.js";

export function App() {
  const [adminOpen, setAdminOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"app" | "settings">("app");

  const { session, setSession, serverStatus, logout, updateDisplayName } = useAuthSession(() => setAdminOpen(false));
  const projectsHandle = useProjects(Boolean(session && session !== "loading"));
  const routing = useProjectRouting(session, projectsHandle.projects);

  if (routing.inviteToken) {
    return (
      <div className={APP_SHELL}>
        <AcceptInvite
          token={routing.inviteToken}
          onLoggedIn={(s) => {
            setSession(s);
            setViewMode("app");
            window.history.replaceState(null, "", "/");
          }}
        />
      </div>
    );
  }

  if (session === "loading") {
    return <div className={APP_SHELL} />;
  }

  // 1. Direct Open Project takes precedence if a project is loaded and user is authenticated
  if (routing.openProject && session) {
    return (
      <div className={APP_SHELL}>
        {/* Inner boundary, keyed on the project: a crash inside one document
            (a bad entity from a collaborator, a misbehaving plugin command)
            shouldn't look like the whole app died, and "back to my projects"
            recovers without a reload — the outer boundary in main.tsx can only
            offer that reload. The key also clears a stuck error state when the
            user opens a different project. */}
        <ErrorBoundary
          key={routing.openProject.id}
          title="Ce projet n'a pas pu s'afficher"
          onReset={routing.closeProject}
          resetLabel="Retour à mes projets"
        >
          <ProjectEditor
            project={routing.openProject}
            session={session}
            onDisplayNameChange={updateDisplayName}
            onLogout={() => {
              logout();
              window.history.pushState(null, "", "/");
            }}
            onBack={routing.closeProject}
          />
        </ErrorBoundary>
      </div>
    );
  }

  // 2. Not authenticated -> Login (direct project URL or otherwise)
  if (!session) {
    return (
      <Login
        onLoggedIn={(s) => {
          setSession(s);
          setViewMode("app");
        }}
      />
    );
  }

  // 3. Settings View
  if (viewMode === "settings") {
    return (
      <SettingsPage
        session={session}
        onBack={() => setViewMode("app")}
        onDisplayNameChange={updateDisplayName}
        onLogout={() => {
          logout();
          window.history.pushState(null, "", "/");
        }}
      />
    );
  }

  // 4. Admin Console View
  if (adminOpen) {
    return <AdminConsole onClose={() => setAdminOpen(false)} />;
  }

  // 5. Default Workspace Dashboard View
  return (
    <ProjectListScreen
      session={session}
      serverStatus={serverStatus}
      projects={projectsHandle.projects}
      projectsLoaded={projectsHandle.loaded}
      openLinkError={routing.openLinkError}
      onOpenProject={routing.openProjectAndNavigate}
      onOpenAdmin={() => setAdminOpen(true)}
      onOpenSettings={() => setViewMode("settings")}
      onLogout={() => {
        logout();
        window.history.pushState(null, "", "/");
      }}
      onDisplayNameChange={updateDisplayName}
      onCreateProject={projectsHandle.createProject}
      onRenameProject={projectsHandle.renameProject}
      onSetProjectStatus={projectsHandle.setProjectStatus}
      onDeleteProjectForever={projectsHandle.deleteProjectForever}
      onEmptyTrash={projectsHandle.emptyTrash}
    />
  );
}
