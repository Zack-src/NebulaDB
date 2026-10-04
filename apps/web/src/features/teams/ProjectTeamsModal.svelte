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
  import Select from "@/components/ui/Select.svelte";
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
  const permissionOptions = $derived(PERMISSION_LEVELS.map((level) => ({ value: level, label: t(PERMISSION_LABEL_KEY[level]) })));
</script>

<Modal title={t("teams.modalTitle", { name: project.name })} {onClose}>
  <Hint>{t("teams.visibilityNote")}</Hint>
  <div class="mb-7 flex max-w-[420px] gap-2">
    <Select
      class="min-w-0 flex-1"
      bind:value={selectedTeamId}
      options={assignableTeams.map((team) => ({ value: team.id, label: team.name }))}
      placeholder={t("teams.assignPlaceholder")}
      aria-label={t("teams.assignPlaceholder")}
    />
    <Select class="w-40" bind:value={selectedPermission} options={permissionOptions} aria-label={t("teams.permission")} />
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
          <Select
            size="sm"
            class="w-36"
            value={grant.permission}
            options={permissionOptions}
            onChange={(permission) => void assignTeam.run(grant.teamId, permission)}
            aria-label={t("teams.permission")}
          />
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
