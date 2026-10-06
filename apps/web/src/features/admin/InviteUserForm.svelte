<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { PlusIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import { INPUT_CLASS } from "@/components/ui/inputStyles";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { createInvitation } from "@/services/invitationsApi";
  import { fetchTeams } from "@/services/teamsApi";
  import { listAdminConnections } from "@/services/dbAdminApi";
  import DbAccessEditor, { grantsFromDraft, type DbAccessDraft } from "./DbAccessEditor.svelte";

  const { t } = useTranslation();
  let { onCreated }: { onCreated: () => void } = $props();
  let email = $state("");
  let invitingAsAdmin = $state(false);
  let lastInvite = $state<{ email: string; emailSent: boolean } | null>(null);

  // What the account gets the moment the invitation is accepted: teams to
  // join, and access to databases with the account name proposed on each.
  const teams = useAsyncResource(fetchTeams);
  const connections = useAsyncResource(listAdminConnections);
  let showGrants = $state(true);
  let teamIds = $state<string[]>([]);
  let databases = $state<DbAccessDraft>({});
  const grantCount = $derived(teamIds.length + grantsFromDraft(databases, true, true).length);

  const invite = useAsyncAction(async () => {
    lastInvite = null;
    const created = await createInvitation(email.trim(), invitingAsAdmin, {
      teamIds,
      databases: grantsFromDraft(databases, true, true),
    });
    lastInvite = { email: created.email, emailSent: created.emailSent };
    email = "";
    invitingAsAdmin = false;
    teamIds = [];
    databases = {};
    showGrants = true;
    onCreated();
  });

  function toggleTeam(id: string, checked: boolean) {
    teamIds = checked ? [...teamIds, id] : teamIds.filter((teamId) => teamId !== id);
  }

  function handleInvite() {
    if (email.trim()) void invite.run();
  }

  const error = $derived(invite.error ?? teams.error ?? connections.error);
</script>

<div>
  <div class="mb-7 flex max-w-[720px] flex-wrap items-center gap-2">
    <input
      class={`${INPUT_CLASS} flex-1`}
      placeholder={t("admin.invitations.emailPlaceholder")}
      bind:value={email}
      onkeydown={(event) => event.key === "Enter" && handleInvite()}
    />
    <Checkbox bind:checked={invitingAsAdmin} class="whitespace-nowrap">
      <span class="text-[13px] text-text-muted">{t("common.admin")}</span>
    </Checkbox>
    <Button variant="primary" onclick={handleInvite} disabled={invite.pending || !email.trim()}>
      <Icon icon={PlusIcon} size={14} />
      {t("admin.invitations.invite")}
    </Button>
  </div>
  <div class="-mt-5 mb-6">
    <Button size="sm" variant="ghost" onclick={() => (showGrants = !showGrants)} aria-expanded={showGrants}>
      {grantCount > 0 ? t("admin.invitations.grantsWithCount", { count: grantCount }) : t("admin.invitations.grants")}
    </Button>
    {#if showGrants}
      <div
        class="mt-2 flex max-w-[720px] flex-col gap-4 rounded-md border border-border p-3"
        data-testid="invitation-grants"
      >
        <div>
          <div class="mb-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
            {t("admin.invitations.teams")}
          </div>
          {#if (teams.data ?? []).length === 0}
            <p class="m-0 text-label text-text-muted">
              {teams.loading ? t("common.loading") : t("admin.invitations.noTeams")}
            </p>
          {:else}
            <div class="flex flex-wrap gap-x-4 gap-y-1.5">
              {#each teams.data ?? [] as team (team.id)}
                <Checkbox checked={teamIds.includes(team.id)} onChange={(checked) => toggleTeam(team.id, checked)}>
                  <span class="text-[13px]">{team.name}</span>
                </Checkbox>
              {/each}
            </div>
          {/if}
        </div>
        <div>
          <div class="mb-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
            {t("admin.invitations.databases")}
          </div>
          {#if connections.data}
            <DbAccessEditor connections={connections.data} bind:value={databases} withAccounts withCreate />
          {:else}
            <p class="m-0 text-label text-text-muted">{t("common.loading")}</p>
          {/if}
        </div>
      </div>
    {/if}
  </div>
  {#if lastInvite}
    <p class="-mt-4 mb-5 text-xs text-text-muted" role="status">
      {lastInvite.emailSent
        ? t("admin.invitations.emailSent", { email: lastInvite.email })
        : t("admin.invitations.emailNotSent", { email: lastInvite.email })}
    </p>
  {/if}
  {#if error}<ErrorText>{error}</ErrorText>{/if}
</div>
