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
  import Select from "@/components/ui/Select.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { addTeamMember, fetchTeam, removeTeamMember } from "@/services/teamsApi";
  import { fetchUsers } from "@/services/usersApi";
  import { toast } from "@/components/ui/toast.svelte";
  import { fetchTeamDbAccess, saveTeamDbAccess } from "@/services/dbAccessApi";
  import { listAdminConnections } from "@/services/dbAdminApi";
  import DbAccessEditor, { draftFromGrants, grantsFromDraft, type DbAccessDraft } from "./DbAccessEditor.svelte";

  let { teamId, onClose, onChanged }: { teamId: string; onClose: () => void; onChanged: () => void } = $props();

  import { provisionDbAccounts } from "@/services/dbAccessApi";
  let provisionSummary = $state("");
  const provision = useAsyncAction(async () => {
    await saveTeamDbAccess(teamId, grantsFromDraft(accessDraft, false));
    const { results } = await provisionDbAccounts("teams", teamId);
    provisionSummary = t("dbAccess.provisionResult", {
      created: results.filter((r) => r.status === "created").length,
      skipped: results.filter((r) => r.status === "existing").length,
      failed: results.filter((r) => r.status === "failed").length,
    });
  });
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
  // Database access every member of the team inherits — read or write, per connection.
  const connections = useAsyncResource(listAdminConnections);
  const dbAccess = useAsyncResource(() => fetchTeamDbAccess(teamId));
  let accessDraft = $state<DbAccessDraft>({});
  let accessSeeded = false;
  $effect(() => {
    if (accessSeeded || !dbAccess.data) return;
    accessSeeded = true;
    accessDraft = draftFromGrants(dbAccess.data);
  });
  const saveAccess = useAsyncAction(async () => {
    await saveTeamDbAccess(teamId, grantsFromDraft(accessDraft, false));
    toast.success(t("dbAccess.teamSaved"));
  });

  const error = $derived(
    team.error ?? addMember.error ?? removeMember.error ?? connections.error ?? dbAccess.error ?? saveAccess.error,
  );
</script>

<Modal title={team.data ? t("admin.teams.detailTitle", { name: team.data.name }) : t("admin.teams.one")} {onClose}>
  <p class="mb-2 text-xs text-text-muted">{t("dbAccess.provisionHint")}</p>
  <Button
    size="sm"
    class="mb-3"
    onclick={() => void provision.run()}
    disabled={provision.pending || !dbAccess.data || !connections.data || saveAccess.pending}
    >{t("dbAccess.provision")}</Button
  >
  {#if provisionSummary}<p class="mb-3 text-xs" role="status">{provisionSummary}</p>{/if}
  {#if provision.error}<ErrorText>{provision.error}</ErrorText>{/if}
  {#if error}<ErrorText>{error}</ErrorText>{/if}
  {#if team.data}
    <div class="mb-7 flex max-w-[420px] gap-2">
      <Select
        class="min-w-0 flex-1"
        bind:value={selectedUserId}
        options={assignableUsers.map((user) => ({ value: user.id, label: `${user.displayName} (${user.email})` }))}
        placeholder={t("admin.teams.addMemberPlaceholder")}
        aria-label={t("admin.teams.addMemberPlaceholder")}
      />
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
    <section class="mt-7 border-t border-border pt-4" aria-label={t("dbAccess.teamTitle")}>
      <h3 class="m-0 mb-2 text-body-sm font-semibold text-text">{t("dbAccess.teamTitle")}</h3>
      {#if connections.data && dbAccess.data}
        <DbAccessEditor
          connections={connections.data}
          bind:value={accessDraft}
          withAccounts={false}
          disabled={saveAccess.pending}
        />
        <div class="mt-3 flex justify-end">
          <Button size="sm" variant="primary" onclick={() => void saveAccess.run()} disabled={saveAccess.pending}>
            {t("dbAccess.teamSave")}
          </Button>
        </div>
      {:else}
        <p class="m-0 text-label text-text-muted">{t("common.loading")}</p>
      {/if}
    </section>
  {/if}
</Modal>
