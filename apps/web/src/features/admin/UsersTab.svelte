<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { KeyIcon, LogOutIcon, RestoreIcon, TrashIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import List from "@/components/ui/List.svelte";
  import ListMain from "@/components/ui/ListMain.svelte";
  import ListRow from "@/components/ui/ListRow.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatDate } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { fetchUsers, setUserDisabled } from "@/services/usersApi";
  import type { UserSummary } from "@/types";
  import ResetPasswordModal from "@/features/admin/ResetPasswordModal.svelte";
  import DeleteUserModal from "@/features/admin/DeleteUserModal.svelte";

  const { t } = useTranslation();
  const users = useAsyncResource(fetchUsers);
  let resetTarget = $state.raw<UserSummary | null>(null);
  let deleteTarget = $state.raw<UserSummary | null>(null);
  let pendingUserId = $state<string | null>(null);

  /**
   * Disabling is the reversible half of offboarding and the one to reach for
   * first: the account stops working immediately (its sessions are deleted
   * server-side and any open WebSocket is closed), but nothing it owns is
   * touched, so the decision can be walked back.
   */
  const toggleDisabled = useAsyncAction(async (user: UserSummary, disabled: boolean) => {
    pendingUserId = user.id;
    try {
      await setUserDisabled(user.id, disabled);
      users.reload();
    } finally {
      pendingUserId = null;
    }
  });

  const rows = $derived(users.data ?? []);
</script>

<div>
  {#if users.error ?? toggleDisabled.error}<ErrorText>{users.error ?? toggleDisabled.error}</ErrorText>{/if}
  {#if rows.length === 0}
    <EmptyState>{users.loading ? t("common.loading") : t("admin.users.empty")}</EmptyState>
  {:else}
    <List>
      {#each rows as user (user.id)}
        {@const disabled = Boolean(user.disabledAt)}
        <ListRow>
          <ListMain>
            <span class={disabled ? "line-through text-text-muted" : undefined}>{user.displayName}</span>
            <span class="text-text-muted">{user.email}</span>
            {#if user.isAdmin}<Badge tone="admin">{t("common.admin")}</Badge>{/if}
            {#if disabled}<Badge tone="danger">{t("admin.users.disabled")}</Badge>{/if}
          </ListMain>
          <span class="text-xs text-text-muted">{formatDate(user.createdAt, i18n.locale)}</span>
          <Button
            variant="ghost"
            size="icon"
            data-tooltip={t("admin.users.resetPassword")}
            onclick={() => (resetTarget = user)}
          >
            <Icon icon={KeyIcon} size={13} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={pendingUserId === user.id}
            data-tooltip={disabled ? t("admin.users.enable") : t("admin.users.disable")}
            onclick={() => void toggleDisabled.run(user, !disabled)}
          >
            {#if disabled}<Icon icon={RestoreIcon} size={13} />{:else}<Icon icon={LogOutIcon} size={13} />{/if}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            data-tooltip={t("admin.users.deleteForever")}
            onclick={() => (deleteTarget = user)}
          >
            <Icon icon={TrashIcon} size={13} />
          </Button>
        </ListRow>
      {/each}
    </List>
  {/if}
  {#if resetTarget}
    <ResetPasswordModal targetUser={resetTarget} onClose={() => (resetTarget = null)} />
  {/if}
  {#if deleteTarget}
    <DeleteUserModal
      targetUser={deleteTarget}
      users={rows}
      onClose={() => (deleteTarget = null)}
      onDeleted={() => {
        deleteTarget = null;
        users.reload();
      }}
    />
  {/if}
</div>
