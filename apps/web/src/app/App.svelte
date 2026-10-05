<script lang="ts">
  import { useAuthSession } from "@/features/auth/authSession.svelte";
  import { useProjects } from "@/features/projects/projects.svelte";
  import { useProjectRouting } from "@/features/projects/projectRouting.svelte";
  import ErrorBoundary from "@/app/ErrorBoundary.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import ProjectEditor from "@/features/editor/ProjectEditor.svelte";
  import ProjectListScreen from "@/features/projects/ProjectListScreen.svelte";
  import Login from "@/features/auth/Login.svelte";
  import SettingsPage from "@/features/settings/SettingsPage.svelte";
  import AcceptInvite from "@/features/auth/AcceptInvite.svelte";
  import ResetPassword from "@/features/auth/ResetPassword.svelte";
  import AdminConsole from "@/features/admin/AdminConsole.svelte";
  import { APP_SHELL } from "@/components/ui/layout";
  import type { CreateProjectFromDatabaseResponse } from "@/services/connectionsApi";
  import WorkspaceShell from "@/components/layout/WorkspaceShell.svelte";
  import { shellHash, shellViewFromHash, type ShellView } from "@/app/shellNavigation";
  import DatabaseWorkspace from "@/features/workspace/DatabaseWorkspace.svelte";

  const { t } = useTranslation();
  let viewMode = $state<ShellView>("app");

  const auth = useAuthSession(() => (viewMode = "app"));
  const projectsHandle = useProjects(() => Boolean(auth.session && auth.session !== "loading"));
  const routing = useProjectRouting(
    () => auth.session,
    () => projectsHandle.projects,
  );
  // Set once AcceptInvite finishes creating an account, so the login screen
  // that follows shows a "welcome, sign in" banner and pre-fills the email
  // instead of looking like an unrelated login prompt. Also stands in for
  // "the invite step is done": `routing.inviteToken` is read once at mount
  // and never clears itself, so without this the app would keep showing
  // AcceptInvite forever after a successful accept.
  let welcomeEmail = $state<string | null>(null);
  // Same "step done" role as `welcomeEmail`, for an emailed reset link.
  let resetEmail = $state<string | null>(null);

  const session = $derived(auth.session);

  $effect(() => {
    if (!session || session === "loading") return;
    viewMode = shellViewFromHash(location.hash, session.isAdmin);
    const sync = () => {
      viewMode = shellViewFromHash(location.hash, session.isAdmin);
    };
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  });

  function navigate(view: ShellView) {
    if (session && session !== "loading" && !session.isAdmin && view === "admin") return;
    routing.closeProject();
    viewMode = view;
    history.replaceState(null, "", `/${shellHash(view)}`);
  }

  function openProjectById(id: string) {
    viewMode = "app";
    routing.openProjectById(id);
  }

  // The new project already has its schema pulled in by the time this fires
  // (`createProjectFromDatabase` did that server-side) — refresh the list so
  // it shows up there too, then navigate straight into the populated canvas.
  function handleProjectCreatedFromDatabase(result: CreateProjectFromDatabaseResponse) {
    projectsHandle.refreshProjects();
    viewMode = "app";
    routing.openProjectById(result.id);
  }
</script>

{#if routing.inviteToken && !welcomeEmail}
  <div class={APP_SHELL}>
    <AcceptInvite
      token={routing.inviteToken}
      onAccepted={(email) => {
        welcomeEmail = email;
        window.history.replaceState(null, "", "/");
      }}
    />
  </div>
{:else if routing.resetToken && !resetEmail}
  <div class={APP_SHELL}>
    <ResetPassword
      token={routing.resetToken}
      onDone={(email) => {
        resetEmail = email;
        window.history.replaceState(null, "", "/");
      }}
    />
  </div>
{:else if session === "loading"}
  <div class={APP_SHELL}></div>
{:else if !session}
  <Login
    initialEmail={resetEmail ?? welcomeEmail ?? undefined}
    initialNotice={resetEmail ? "passwordReset" : "accountCreated"}
    onLoggedIn={(next) => {
      auth.setSession(next);
      viewMode = "app";
    }}
  />
{:else}
  <WorkspaceShell
    {session}
    view={viewMode}
    projectName={viewMode === "app" ? routing.openProject?.name : undefined}
    onNavigate={navigate}
    onLogout={auth.logout}
    onOpenProject={openProjectById}
  >
    {#if routing.openProject && viewMode === "app"}
      <!-- 1. Direct Open Project takes precedence if a project is loaded and user is authenticated -->
      <div class="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
        <!-- Inner boundary, keyed on the project: a crash inside one document
         (a bad entity from a collaborator, a misbehaving plugin command)
         shouldn't look like the whole app died, and "back to my projects"
         recovers without a reload — the outer boundary in Root can only
         offer that reload. The key also clears a stuck error state when the
         user opens a different project. -->
        {#key routing.openProject.id}
          <ErrorBoundary
            title={t("errorBoundary.projectTitle")}
            onReset={routing.closeProject}
            resetLabel={t("errorBoundary.backToProjects")}
          >
            <ProjectEditor
              project={routing.openProject}
              {session}
              onDisplayNameChange={auth.updateDisplayName}
              onLogout={auth.logout}
              onBack={() => navigate("app")}
              onOpenSettings={() => navigate("settings")}
              initialFocus={routing.focusTarget}
              tab={routing.tab}
              onTabChange={routing.setTab}
              onOpenProject={openProjectById}
            />
          </ErrorBoundary>
        {/key}
      </div>
    {:else if viewMode === "settings"}
      <!-- 3. Settings View -->
      <SettingsPage
        {session}
        embedded
        onBack={() => navigate("app")}
        onDisplayNameChange={auth.updateDisplayName}
        onLogout={auth.logout}
      />
    {:else if viewMode === "admin" && session.isAdmin}
      <!-- 4. Admin Console View -->
      <AdminConsole embedded initialSection="users" onClose={() => navigate("app")} />
    {:else if viewMode === "bases"}
      <div class="min-h-0 flex-1 overflow-auto p-4 md:p-6">
        <div class="mx-auto max-w-[1240px]">
          <h1 class="mb-5 text-xl font-semibold tracking-tight">{t("shell.bases")}</h1>
          <DatabaseWorkspace {session} />
        </div>
      </div>
    {:else}
      <!-- 5. Default Workspace Dashboard View -->
      <ProjectListScreen
        {session}
        embedded
        projects={projectsHandle.projects}
        projectsLoaded={projectsHandle.loaded}
        openLinkError={routing.openLinkError}
        onOpenProject={(project) => {
          viewMode = "app";
          routing.openProjectAndNavigate(project);
        }}
        onOpenSearchHit={(hit) =>
          hit.tableName &&
          routing.openProjectById(hit.projectId, { tableName: hit.tableName, fieldName: hit.fieldName })}
        onOpenAdmin={() => navigate("admin")}
        onOpenSettings={() => navigate("settings")}
        onOpenProjectById={openProjectById}
        onLogout={auth.logout}
        onCreateProject={projectsHandle.createProject}
        onRenameProject={projectsHandle.renameProject}
        onSetProjectStatus={projectsHandle.setProjectStatus}
        onDeleteProjectForever={projectsHandle.deleteProjectForever}
        onEmptyTrash={projectsHandle.emptyTrash}
        onProjectCreatedFromDatabase={handleProjectCreatedFromDatabase}
      />
    {/if}
  </WorkspaceShell>
{/if}
