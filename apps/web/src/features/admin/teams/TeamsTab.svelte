<script lang="ts">
  import Input from "@/components/ui/Input.svelte";
  import PageToolbar from "@/components/layout/PageToolbar.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { PlusIcon, TrashIcon, UsersIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import List from "@/components/ui/List.svelte";
  import ListMain from "@/components/ui/ListMain.svelte";
  import ListRow from "@/components/ui/ListRow.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { createTeam, deleteTeam, fetchTeams } from "@/services/teamsApi";
  import TeamDetailView from "@/features/admin/teams/TeamDetailView.svelte";

  const { t } = useTranslation();
  const teams = useAsyncResource(fetchTeams);
  let newTeamName = $state("");
  let selectedTeamId = $state<string | null>(null);

  const addTeam = useAsyncAction(async () => {
    await createTeam(newTeamName.trim());
    newTeamName = "";
    teams.reload();
  });

  const removeTeam = useAsyncAction(async (teamId: string) => {
    await deleteTeam(teamId);
    teams.reload();
  });

  function handleCreate() {
    if (newTeamName.trim()) void addTeam.run();
  }

  const rows = $derived(teams.data ?? []);
  const error = $derived(teams.error ?? addTeam.error ?? removeTeam.error);
</script>

<div>
  {#if selectedTeamId}
    <TeamDetailView teamId={selectedTeamId} onClose={() => (selectedTeamId = null)} onChanged={teams.reload} />
  {:else}
  <PageToolbar>
    <Input
      class="min-w-[240px] flex-1"
      placeholder={t("admin.teams.namePlaceholder")}
      bind:value={newTeamName}
      onkeydown={(event) => event.key === "Enter" && handleCreate()}
    />
    <Button variant="primary" onclick={handleCreate} disabled={addTeam.pending || !newTeamName.trim()}>
      <Icon icon={PlusIcon} size={14} />
      {t("admin.teams.create")}
    </Button>
  </PageToolbar>
  {#if error}<ErrorText>{error}</ErrorText>{/if}
  {#if rows.length === 0}
    <EmptyState>{teams.loading ? t("common.loading") : t("admin.teams.empty")}</EmptyState>
  {:else}
    <List>
      {#each rows as team (team.id)}
        <ListRow>
          <ListMain as="button" onclick={() => (selectedTeamId = team.id)}>
            <Icon icon={UsersIcon} size={13} class="text-text-muted" />
            <span>{team.name}</span>
            <span class="text-text-muted">{t("admin.teams.memberCount", { count: team.memberCount })}</span>
          </ListMain>
          <Button
            variant="ghost"
            size="icon"
            data-tooltip={t("admin.teams.delete")}
            onclick={() => void removeTeam.run(team.id)}
          >
            <Icon icon={TrashIcon} size={13} />
          </Button>
        </ListRow>
      {/each}
    </List>
  {/if}
  {/if}
</div>
