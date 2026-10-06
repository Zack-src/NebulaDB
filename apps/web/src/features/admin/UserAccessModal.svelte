<script lang="ts">
  import Modal from "@/components/overlays/Modal.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { PlusIcon, TrashIcon } from "@/components/icons/Icons";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import List from "@/components/ui/List.svelte";
  import ListMain from "@/components/ui/ListMain.svelte";
  import ListRow from "@/components/ui/ListRow.svelte";
  import Select from "@/components/ui/Select.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { fetchProjects, grantProjectMember, revokeProjectMember } from "@/services/projectsApi";
  import { addTeamMember, fetchTeams, removeTeamMember } from "@/services/teamsApi";
  import { fetchUserAccess } from "@/services/usersApi";
  import type { PermissionLevel, UserSummary } from "@/types";
  import { permissionOptions } from "./permissionOptions";

  /**
   * Admin → Utilisateurs → "Équipes et projets": the person's side of what the
   * team and project screens edit. Their teams, and the projects they own or
   * were given a level on themselves — which is how someone becomes
   * administrator of a project they did not create.
   */
  let { targetUser, onClose }: { targetUser: UserSummary; onClose: () => void } = $props();

  const { t } = useTranslation();
  const access = useAsyncResource(() => fetchUserAccess(targetUser.id));
  const teams = useAsyncResource(fetchTeams);
  const projects = useAsyncResource(fetchProjects);
  let selectedTeamId = $state("");
  let selectedProjectId = $state("");
  let selectedPermission = $state<PermissionLevel>("administrator");

  const joinTeam = useAsyncAction(async () => {
    await addTeamMember(selectedTeamId, targetUser.id);
    selectedTeamId = "";
    access.reload();
  });
  const leaveTeam = useAsyncAction(async (teamId: string) => {
    await removeTeamMember(teamId, targetUser.id);
    access.reload();
  });
  const grant = useAsyncAction(async (projectId: string, permission: PermissionLevel) => {
    await grantProjectMember(projectId, targetUser.id, permission);
    selectedProjectId = "";
    access.reload();
  });
  const revoke = useAsyncAction(async (projectId: string) => {
    await revokeProjectMember(projectId, targetUser.id);
    access.reload();
  });

  const memberOf = $derived(access.data?.teams ?? []);
  const reached = $derived(access.data?.projects ?? []);
  const joinableTeams = $derived((teams.data ?? []).filter((team) => !memberOf.some((mine) => mine.id === team.id)));
  // A project they own is already theirs to administer: nothing a grant would add.
  const grantableProjects = $derived(
    (projects.data ?? []).filter(
      (project) => project.status === "active" && !reached.some((mine) => mine.projectId === project.id),
    ),
  );
  const levels = $derived(permissionOptions(t));
  const error = $derived(
    access.error ??
      teams.error ??
      projects.error ??
      joinTeam.error ??
      leaveTeam.error ??
      grant.error ??
      revoke.error,
  );
</script>

<Modal title={t("admin.access.title", { name: targetUser.displayName })} {onClose}>
  {#if targetUser.isAdmin}<Hint>{t("admin.access.adminNote")}</Hint>{/if}
  {#if error}<ErrorText>{error}</ErrorText>{/if}

  <section aria-label={t("admin.access.teams")}>
    <h3 class="m-0 mb-2 text-body-sm font-semibold text-text">{t("admin.access.teams")}</h3>
    <div class="mb-3 flex max-w-[420px] gap-2">
      <Select
        class="min-w-0 flex-1"
        bind:value={selectedTeamId}
        options={joinableTeams.map((team) => ({ value: team.id, label: team.name }))}
        placeholder={t("admin.access.addTeam")}
        aria-label={t("admin.access.addTeam")}
      />
      <Button variant="primary" onclick={() => void joinTeam.run()} disabled={!selectedTeamId || joinTeam.pending}>
        <Icon icon={PlusIcon} size={14} />
        {t("common.add")}
      </Button>
    </div>
    {#if memberOf.length === 0}
      <EmptyState>{access.loading ? t("common.loading") : t("admin.access.noTeams")}</EmptyState>
    {:else}
      <List>
        {#each memberOf as team (team.id)}
          <ListRow>
            <ListMain><span>{team.name}</span></ListMain>
            <Button
              variant="ghost"
              size="icon"
              data-tooltip={t("admin.teams.removeMember")}
              aria-label={t("admin.teams.removeMember")}
              onclick={() => void leaveTeam.run(team.id)}
            >
              <Icon icon={TrashIcon} size={13} />
            </Button>
          </ListRow>
        {/each}
      </List>
    {/if}
  </section>

  <section class="mt-7 border-t border-border pt-4" aria-label={t("admin.access.projects")}>
    <h3 class="m-0 mb-2 text-body-sm font-semibold text-text">{t("admin.access.projects")}</h3>
    <Hint>{t("admin.access.projectsHint")}</Hint>
    <div class="mb-3 flex gap-2">
      <Select
        class="min-w-0 flex-1"
        bind:value={selectedProjectId}
        options={grantableProjects.map((project) => ({ value: project.id, label: project.name }))}
        placeholder={t("admin.access.addProject")}
        aria-label={t("admin.access.addProject")}
      />
      <Select class="w-40" bind:value={selectedPermission} options={levels} aria-label={t("teams.permission")} />
      <Button
        variant="primary"
        onclick={() => void grant.run(selectedProjectId, selectedPermission)}
        disabled={!selectedProjectId || grant.pending}
      >
        <Icon icon={PlusIcon} size={14} />
        {t("common.add")}
      </Button>
    </div>
    {#if reached.length === 0}
      <EmptyState>{access.loading ? t("common.loading") : t("admin.access.noProjects")}</EmptyState>
    {:else}
      <List>
        {#each reached as project (project.projectId)}
          <ListRow>
            <ListMain>
              <span>{project.projectName}</span>
              {#if project.owner}<Badge tone="muted">{t("admin.access.owner")}</Badge>{/if}
            </ListMain>
            {#if project.permission}
              <Select
                size="sm"
                class="w-36"
                value={project.permission}
                options={levels}
                onChange={(permission) => void grant.run(project.projectId, permission)}
                aria-label={t("teams.permission")}
              />
              <Button
                variant="ghost"
                size="icon"
                data-tooltip={t("admin.access.removeProject")}
                aria-label={t("admin.access.removeProject")}
                onclick={() => void revoke.run(project.projectId)}
              >
                <Icon icon={TrashIcon} size={13} />
              </Button>
            {:else}
              <span class="text-xs text-text-muted">{t("permission.administrator")}</span>
            {/if}
          </ListRow>
        {/each}
      </List>
    {/if}
  </section>
</Modal>
