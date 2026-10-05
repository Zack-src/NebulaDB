<script lang="ts">
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
  const error = $derived(connections.error ?? access.error ?? save.error);
</script>

<Modal title={t("dbAccess.userTitle", { name: targetUser.displayName })} {onClose} dismissable={!save.pending}>
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
    <div class="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
      <Button size="sm" variant="ghost" onclick={onClose} disabled={save.pending}>{t("common.cancel")}</Button>
      <Button size="sm" variant="primary" onclick={() => void save.run()} disabled={save.pending}>
        {t("common.save")}
      </Button>
    </div>
  {/if}
</Modal>
