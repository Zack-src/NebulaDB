<script lang="ts" module>
  import type { PermissionLevel, TranslationKeyOf } from "@/types";

  const PERMISSION_LEVELS: PermissionLevel[] = ["view", "edit", "administrator"];

  const PERMISSION_LABEL_KEY = {
    view: "permission.view",
    edit: "permission.edit",
    administrator: "permission.administrator",
  } as const satisfies Record<PermissionLevel, TranslationKeyOf>;
</script>

<script lang="ts">
  import Modal from "@/components/overlays/Modal.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { PlusIcon, TrashIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import List from "@/components/ui/List.svelte";
  import ListMain from "@/components/ui/ListMain.svelte";
  import ListRow from "@/components/ui/ListRow.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import { SELECT_CLASS, SELECT_SM_CLASS } from "@/components/ui/inputStyles";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { fetchProjectTeams, grantProjectTeam, revokeProjectTeam } from "@/services/projectsApi";
  import { fetchTeams } from "@/services/teamsApi";
  import type { ProjectSummary } from "@/types";

  /**
   * Assigns teams (and a permission level each) to a project — reachable by
   * anyone who can manage that project, not just global admins.
   */
  let { project, onClose }: { project: ProjectSummary; onClose: () => void } = $props();

  const { t } = useTranslation();
  const grants = useAsyncResource(() => fetchProjectTeams(project.id));
  const teams = useAsyncResource(fetchTeams);
  let selectedTeamId = $state("");
  let selectedPermission = $state<PermissionLevel>("view");

  const assignTeam = useAsyncAction(async (teamId: string, permission: PermissionLevel) => {
    await grantProjectTeam(project.id, teamId, permission);
    grants.reload();
  });

  const unassignTeam = useAsyncAction(async (teamId: string) => {
    await revokeProjectTeam(project.id, teamId);
    grants.reload();
  });

  async function handleAssign() {
    if (!selectedTeamId) return;
    if (await assignTeam.run(selectedTeamId, selectedPermission)) selectedTeamId = "";
  }

  const rows = $derived(grants.data ?? []);
  const assignableTeams = $derived((teams.data ?? []).filter((team) => !rows.some((grant) => grant.teamId === team.id)));
  const error = $derived(grants.error ?? assignTeam.error ?? unassignTeam.error);
</script>

{#snippet permissionOptions()}
  {#each PERMISSION_LEVELS as level (level)}
    <option value={level}>{t(PERMISSION_LABEL_KEY[level])}</option>
  {/each}
{/snippet}

<Modal title={t("teams.modalTitle", { name: project.name })} {onClose}>
  <Hint>{t("teams.visibilityNote")}</Hint>
  <div class="mb-7 flex max-w-[420px] gap-2">
    <select class={SELECT_CLASS} bind:value={selectedTeamId}>
      <option value="">{t("teams.assignPlaceholder")}</option>
      {#each assignableTeams as team (team.id)}
        <option value={team.id}>{team.name}</option>
      {/each}
    </select>
    <select class={SELECT_CLASS} bind:value={selectedPermission}>
      {@render permissionOptions()}
    </select>
    <Button variant="primary" onclick={() => void handleAssign()} disabled={!selectedTeamId}>
      <Icon icon={PlusIcon} size={14} />
      {t("teams.assign")}
    </Button>
  </div>
  {#if error}<ErrorText>{error}</ErrorText>{/if}
  {#if rows.length === 0}
    <EmptyState>{t("teams.noneAssigned")}</EmptyState>
  {:else}
    <List>
      {#each rows as grant (grant.teamId)}
        <ListRow>
          <ListMain>
            <span>{grant.teamName}</span>
          </ListMain>
          <select
            class={SELECT_SM_CLASS}
            value={grant.permission}
            onchange={(event) => void assignTeam.run(grant.teamId, event.currentTarget.value as PermissionLevel)}
          >
            {@render permissionOptions()}
          </select>
          <Button
            variant="ghost"
            size="icon"
            data-tooltip={t("teams.unassign")}
            onclick={() => void unassignTeam.run(grant.teamId)}
          >
            <Icon icon={TrashIcon} size={13} />
          </Button>
        </ListRow>
      {/each}
    </List>
  {/if}
</Modal>
