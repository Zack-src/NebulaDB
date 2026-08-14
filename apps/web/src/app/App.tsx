import { useState } from "react";
import "@xyflow/react/dist/style.css";
import { useAuthSession } from "@/features/auth/hooks/useAuthSession";
import { useProjects } from "@/features/projects/hooks/useProjects";
import { useProjectRouting } from "@/features/projects/hooks/useProjectRouting";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { useTranslation } from "@/i18n/useTranslation";
import { ProjectEditor } from "@/features/editor/ProjectEditor";
import { ProjectListScreen } from "@/features/projects/ProjectListScreen";
import { Login } from "@/features/auth/Login";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { AcceptInvite } from "@/features/auth/AcceptInvite";
import { AdminConsole } from "@/features/admin/AdminConsole";
import { APP_SHELL } from "@/components/ui/layout";

export function App() {
  const { t } = useTranslation();
  const [adminOpen, setAdminOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"app" | "settings">("app");

  const { session, setSession, logout, updateDisplayName } = useAuthSession(() => setAdminOpen(false));
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
          title={t("errorBoundary.projectTitle")}
          onReset={routing.closeProject}
          resetLabel={t("errorBoundary.backToProjects")}
        >
          <ProjectEditor
            project={routing.openProject}
            session={session}
            onDisplayNameChange={updateDisplayName}
            onLogout={logout}
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
        onLogout={logout}
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
      projects={projectsHandle.projects}
      projectsLoaded={projectsHandle.loaded}
      openLinkError={routing.openLinkError}
      onOpenProject={routing.openProjectAndNavigate}
      onOpenAdmin={() => setAdminOpen(true)}
      onOpenSettings={() => setViewMode("settings")}
      onLogout={logout}
      onDisplayNameChange={updateDisplayName}
      onCreateProject={projectsHandle.createProject}
      onRenameProject={projectsHandle.renameProject}
      onSetProjectStatus={projectsHandle.setProjectStatus}
      onDeleteProjectForever={projectsHandle.deleteProjectForever}
      onEmptyTrash={projectsHandle.emptyTrash}
    />
  );
}
