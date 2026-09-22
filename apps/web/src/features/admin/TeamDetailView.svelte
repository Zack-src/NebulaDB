<script lang="ts">
  import Modal from "@/components/overlays/Modal.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { PlusIcon, TrashIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import List from "@/components/ui/List.svelte";
  import ListMain from "@/components/ui/ListMain.svelte";
  import ListRow from "@/components/ui/ListRow.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import { SELECT_CLASS } from "@/components/ui/inputStyles";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { addTeamMember, fetchTeam, removeTeamMember } from "@/services/teamsApi";
  import { fetchUsers } from "@/services/usersApi";

  let { teamId, onClose, onChanged }: { teamId: string; onClose: () => void; onChanged: () => void } = $props();

  const { t } = useTranslation();
  const team = useAsyncResource(() => fetchTeam(teamId));
  const users = useAsyncResource(fetchUsers);
  let selectedUserId = $state("");

  function applyMembershipChange() {
    team.reload();
    onChanged();
  }

  const addMember = useAsyncAction(async () => {
    await addTeamMember(teamId, selectedUserId);
    selectedUserId = "";
    applyMembershipChange();
  });

  const removeMember = useAsyncAction(async (userId: string) => {
    await removeTeamMember(teamId, userId);
    applyMembershipChange();
  });

  const members = $derived(team.data?.members ?? []);
  const assignableUsers = $derived(
    (users.data ?? []).filter((user) => !members.some((member) => member.id === user.id)),
  );
  const error = $derived(team.error ?? addMember.error ?? removeMember.error);
</script>

<Modal title={team.data ? t("admin.teams.detailTitle", { name: team.data.name }) : t("admin.teams.one")} {onClose}>
  {#if error}<ErrorText>{error}</ErrorText>{/if}
  {#if team.data}
    <div class="mb-7 flex max-w-[420px] gap-2">
      <select class={`${SELECT_CLASS} flex-1`} bind:value={selectedUserId}>
        <option value="">{t("admin.teams.addMemberPlaceholder")}</option>
        {#each assignableUsers as user (user.id)}
          <option value={user.id}>{user.displayName} ({user.email})</option>
        {/each}
      </select>
      <Button variant="primary" onclick={() => void addMember.run()} disabled={!selectedUserId}>
        <Icon icon={PlusIcon} size={14} />
        {t("common.add")}
      </Button>
    </div>
    {#if members.length === 0}
      <EmptyState>{t("admin.teams.noMembers")}</EmptyState>
    {:else}
      <List>
        {#each members as member (member.id)}
          <ListRow>
            <ListMain>
              <span>{member.displayName}</span>
              <span class="text-text-muted">{member.email}</span>
            </ListMain>
            <Button
              variant="ghost"
              size="icon"
              data-tooltip={t("admin.teams.removeMember")}
              onclick={() => void removeMember.run(member.id)}
            >
              <Icon icon={TrashIcon} size={13} />
            </Button>
          </ListRow>
        {/each}
      </List>
    {/if}
  {/if}
</Modal>
