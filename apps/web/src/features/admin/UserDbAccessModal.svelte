<script lang="ts">
  import PersonalAccountDialog from "@/features/connections/PersonalAccountDialog.svelte";
  import type { AdminConnectionSummary } from "@athanordb/shared";
  let assigning = $state<AdminConnectionSummary | null>(null);
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import { toast } from "@/components/ui/toast.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { fetchUserDbAccess, saveUserDbAccess } from "@/services/dbAccessApi";
  import { listAdminConnections } from "@/services/dbAdminApi";
  import type { UserSummary } from "@/types";
  import DbAccessEditor, { draftFromGrants, grantsFromDraft, type DbAccessDraft } from "./DbAccessEditor.svelte";

  /**
   * Admin → Utilisateurs → "Accès aux bases": which databases this person may
   * query and with what, and the account name on each database to propose to
   * them (the "associate a database account" of the admin). Their teams'
   * grants are shown alongside, edited on the team.
   */
  let { targetUser, onClose }: { targetUser: UserSummary; onClose: () => void } = $props();

  import { provisionDbAccounts } from "@/services/dbAccessApi";
  let provisionSummary = $state("");
  const provision = useAsyncAction(async () => {
    await saveUserDbAccess(targetUser.id, grantsFromDraft(draft, true));
    const { results } = await provisionDbAccounts("users", targetUser.id);
    provisionSummary = t("dbAccess.provisionResult", {
      created: results.filter((r) => r.status === "created").length,
      skipped: results.filter((r) => r.status === "existing").length,
      failed: results.filter((r) => r.status === "failed").length,
    });
  });
  const { t } = useTranslation();
  const connections = useAsyncResource(listAdminConnections);
  const access = useAsyncResource(() => fetchUserDbAccess(targetUser.id));
  let draft = $state<DbAccessDraft>({});
  let seeded = false;
  $effect(() => {
    if (seeded || !access.data) return;
    seeded = true;
    draft = draftFromGrants(access.data.grants);
  });

  const save = useAsyncAction(async () => {
    await saveUserDbAccess(targetUser.id, grantsFromDraft(draft, true));
    toast.success(t("dbAccess.saved", { name: targetUser.displayName }));
    onClose();
  });
  const assign = useAsyncAction(async (connection: AdminConnectionSummary) => {
    await saveUserDbAccess(targetUser.id, grantsFromDraft(draft, true));
    assigning = connection;
  });
  const error = $derived(connections.error ?? access.error ?? save.error ?? assign.error);
</script>

<Modal title={t("dbAccess.userTitle", { name: targetUser.displayName })} {onClose} dismissable={!save.pending}>
  <p class="mb-2 text-xs text-text-muted">{t("dbAccess.provisionHint")}</p>
  <Button
    size="sm"
    class="mb-3"
    onclick={() => void provision.run()}
    disabled={provision.pending || !access.data || !connections.data || save.pending}>{t("dbAccess.provision")}</Button
  >
  {#if provisionSummary}<p class="mb-3 text-xs" role="status">{provisionSummary}</p>{/if}
  {#if provision.error}<ErrorText>{provision.error}</ErrorText>{/if}
  {#if error}<ErrorText>{error}</ErrorText>{/if}
  {#if !connections.data || !access.data}
    <p class="m-0 text-label text-text-muted">{t("common.loading")}</p>
  {:else}
    {#if targetUser.isAdmin}
      <p class="m-0 mb-2 text-label text-text-muted">{t("dbAccess.adminAlready")}</p>
    {/if}
    <DbAccessEditor
      connections={connections.data}
      bind:value={draft}
      withAccounts
      inherited={access.data.inherited}
      disabled={save.pending}
    />
    <div class="mt-3 flex flex-wrap gap-2">
      {#each connections.data.filter((c) => c.authMode === "personal") as connection (connection.id)}
        <Button size="sm" onclick={() => void assign.run(connection)} disabled={assign.pending}
          >{t("dbAccess.assign", { name: connection.name })}</Button
        >
      {/each}
    </div>
    <div class="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
      <Button size="sm" variant="ghost" onclick={onClose} disabled={save.pending}>{t("common.cancel")}</Button>
      <Button size="sm" variant="primary" onclick={() => void save.run()} disabled={save.pending}>
        {t("common.save")}
      </Button>
    </div>
  {/if}
</Modal>
{#if assigning}<PersonalAccountDialog
    connectionId={assigning.id}
    connectionName={assigning.name}
    targetUserId={targetUser.id}
    status={{ username: null, authMode: "personal", updatedAt: null }}
    onChanged={() => access.reload()}
    onClose={() => (assigning = null)}
  />{/if}
