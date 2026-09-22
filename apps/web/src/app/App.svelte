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
  import AdminConsole from "@/features/admin/AdminConsole.svelte";
  import { APP_SHELL } from "@/components/ui/layout";

  const { t } = useTranslation();
  let adminOpen = $state(false);
  let viewMode = $state<"app" | "settings">("app");

  const auth = useAuthSession(() => (adminOpen = false));
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

  const session = $derived(auth.session);
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
{:else if session === "loading"}
  <div class={APP_SHELL}></div>
{:else if routing.openProject && session}
  <!-- 1. Direct Open Project takes precedence if a project is loaded and user is authenticated -->
  <div class={APP_SHELL}>
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
          onBack={routing.closeProject}
        />
      </ErrorBoundary>
    {/key}
  </div>
{:else if !session}
  <!-- 2. Not authenticated -> Login (direct project URL or otherwise) -->
  <Login
    initialEmail={welcomeEmail ?? undefined}
    onLoggedIn={(next) => {
      auth.setSession(next);
      viewMode = "app";
    }}
  />
{:else if viewMode === "settings"}
  <!-- 3. Settings View -->
  <SettingsPage
    {session}
    onBack={() => (viewMode = "app")}
    onDisplayNameChange={auth.updateDisplayName}
    onLogout={auth.logout}
  />
{:else if adminOpen}
  <!-- 4. Admin Console View -->
  <AdminConsole onClose={() => (adminOpen = false)} />
{:else}
  <!-- 5. Default Workspace Dashboard View -->
  <ProjectListScreen
    {session}
    projects={projectsHandle.projects}
    projectsLoaded={projectsHandle.loaded}
    openLinkError={routing.openLinkError}
    onOpenProject={routing.openProjectAndNavigate}
    onOpenAdmin={() => (adminOpen = true)}
    onOpenSettings={() => (viewMode = "settings")}
    onLogout={auth.logout}
    onCreateProject={projectsHandle.createProject}
    onRenameProject={projectsHandle.renameProject}
    onSetProjectStatus={projectsHandle.setProjectStatus}
    onDeleteProjectForever={projectsHandle.deleteProjectForever}
    onEmptyTrash={projectsHandle.emptyTrash}
  />
{/if}
