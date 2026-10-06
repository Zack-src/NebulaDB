<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import {
    LinkIcon,
    DatabaseIcon,
    KeyIcon,
    LockIcon,
    LockOpenIcon,
    LogOutIcon,
    RestoreIcon,
    TrashIcon,
    UsersIcon,
  } from "@/components/icons/Icons";
  import ConfirmDialog from "@/components/overlays/ConfirmDialog.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatDate } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { fetchUsers, setUserAdmin, setUserDisabled } from "@/services/usersApi";
  import InviteUserForm from "./InviteUserForm.svelte";
  import { memberRows } from "./memberRows";
  import { fetchInvitations, revokeInvitation } from "@/services/invitationsApi";
  import { copyText } from "@/utils/clipboard";
  import type { InvitationSummary } from "@/types";
  import type { UserSummary } from "@/types";
  import ResetPasswordModal from "@/features/admin/ResetPasswordModal.svelte";
  import DeleteUserModal from "@/features/admin/DeleteUserModal.svelte";
  import UserDbAccessModal from "@/features/admin/UserDbAccessModal.svelte";
  import UserAccessModal from "@/features/admin/UserAccessModal.svelte";

  const { t } = useTranslation();
  const users = useAsyncResource(fetchUsers);
  const invitations = useAsyncResource(fetchInvitations);
  let copiedToken = $state<string | null>(null);
  let revokingToken = $state<string | null>(null);
  function refreshMembers() {
    users.reload();
    invitations.reload();
  }
  const revoke = useAsyncAction(async (token: string) => {
    revokingToken = token;
    try {
      await revokeInvitation(token);
      invitations.reload();
    } finally {
      revokingToken = null;
    }
  });
  const copyLink = useAsyncAction(async (invitation: InvitationSummary) => {
    if (await copyText(`${location.origin}/invite/${invitation.token}`)) {
      copiedToken = invitation.token;
      setTimeout(() => {
        if (copiedToken === invitation.token) copiedToken = null;
      }, 1500);
    }
  });
  let resetTarget = $state.raw<UserSummary | null>(null);
  let deleteTarget = $state.raw<UserSummary | null>(null);
  let accessTarget = $state.raw<UserSummary | null>(null);
  let membershipTarget = $state.raw<UserSummary | null>(null);
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

  /**
   * The administrator role opens the whole instance — every project, every
   * database, every account — so giving it or taking it back is asked twice.
   */
  let roleTarget = $state.raw<UserSummary | null>(null);
  const changeRole = useAsyncAction(async (user: UserSummary) => {
    await setUserAdmin(user.id, !user.isAdmin);
    roleTarget = null;
    users.reload();
  });

  const rows = $derived(memberRows(users.data ?? [], invitations.data ?? []));
  const error = $derived(users.error ?? invitations.error ?? toggleDisabled.error ?? revoke.error ?? copyLink.error);
</script>

<div>
  <InviteUserForm onCreated={refreshMembers} />
  {#if error}<ErrorText>{error}</ErrorText>{/if}
  {#if rows.length === 0}
    <EmptyState>{users.loading || invitations.loading ? t("common.loading") : t("admin.users.empty")}</EmptyState>
  {:else}
    <div class="overflow-x-auto rounded-md border border-border">
      <table class="w-full text-left text-xs" aria-label={t("admin.section.users")}>
        <thead class="border-b border-border bg-surface-raised text-text-secondary">
          <tr
            ><th class="px-3 py-2">{t("common.name")}</th><th class="px-3 py-2">{t("admin.users.status")}</th><th
              class="px-3 py-2">{t("admin.errors.column.date")}</th
            ><th class="px-3 py-2 text-right">{t("admin.users.actions")}</th></tr
          >
        </thead>
        <tbody>
          {#each rows as row (row.id)}
            {@const user = row.user}
            {@const invitation = row.invitation}
            {@const disabled = Boolean(user?.disabledAt)}
            <tr class="border-b border-border bg-surface last:border-b-0" data-email={user?.email ?? invitation?.email}>
              <td class="px-3 py-2.5">
                <div class="flex flex-wrap items-center gap-2">
                  {#if user}<strong class={disabled ? "line-through text-text-muted" : "font-medium"}
                      >{user.displayName}</strong
                    >{/if}
                  {#if user?.isAdmin ?? invitation?.isAdmin}<Badge tone="admin">{t("common.admin")}</Badge>{/if}
                </div>
                <span class="text-text-secondary">{user?.email ?? invitation?.email}</span>
                {#if invitation && !user}
                  <div class="mt-1 flex flex-wrap gap-1">
                    {#each invitation.teams ?? [] as team (team.id)}<Badge tone="muted">{team.name}</Badge>{/each}
                    {#each invitation.databases ?? [] as grant (grant.connectionId)}
                      <span
                        data-tooltip={grant.sqlUsername
                          ? t("admin.invitations.databaseAccount", { account: grant.sqlUsername })
                          : undefined}
                        ><Badge tone="muted"
                          >{grant.connectionName}{grant.level ? " · " + t(`dbAccess.level.${grant.level}`) : ""}</Badge
                        ></span
                      >
                    {/each}
                  </div>
                {/if}
              </td>
              <td class="px-3 py-2.5">
                {#if disabled}<Badge tone="danger">{t("admin.users.disabled")}</Badge>
                {:else if invitation}<Badge
                    tone={invitation.status === "accepted"
                      ? "success"
                      : invitation.status === "pending"
                        ? "warning"
                        : "danger"}>{t(`admin.invitations.status.${invitation.status}`)}</Badge
                  >
                {:else}<Badge tone="success">{t("admin.users.active")}</Badge>{/if}
              </td>
              <td class="whitespace-nowrap px-3 py-2.5 text-text-muted"
                >{formatDate(user?.createdAt ?? invitation!.createdAt, i18n.locale)}</td
              >
              <td class="px-3 py-2.5"
                ><div class="flex items-center justify-end gap-1">
                  {#if user}
                    <Button
                      variant="ghost"
                      size="icon"
                      data-tooltip={t("admin.access.button")}
                      aria-label={t("admin.access.title", { name: user.displayName })}
                      onclick={() => (membershipTarget = user)}
                    >
                      <Icon icon={UsersIcon} size={13} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      data-tooltip={t("dbAccess.button")}
                      aria-label={t("dbAccess.userTitle", { name: user.displayName })}
                      onclick={() => (accessTarget = user)}
                    >
                      <Icon icon={DatabaseIcon} size={13} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("admin.users.resetPassword")}
                      data-tooltip={t("admin.users.resetPassword")}
                      onclick={() => (resetTarget = user)}
                    >
                      <Icon icon={KeyIcon} size={13} />
                    </Button>
                    {#if !disabled}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={user.isAdmin ? t("admin.users.demote") : t("admin.users.promote")}
                        data-tooltip={user.isAdmin ? t("admin.users.demote") : t("admin.users.promote")}
                        onclick={() => (roleTarget = user)}
                      >
                        <Icon icon={user.isAdmin ? LockIcon : LockOpenIcon} size={13} />
                      </Button>
                    {/if}
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={pendingUserId === user.id}
                      aria-label={disabled ? t("admin.users.enable") : t("admin.users.disable")}
                      data-tooltip={disabled ? t("admin.users.enable") : t("admin.users.disable")}
                      onclick={() => void toggleDisabled.run(user, !disabled)}
                    >
                      {#if disabled}<Icon icon={RestoreIcon} size={13} />{:else}<Icon
                          icon={LogOutIcon}
                          size={13}
                        />{/if}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("admin.users.deleteForever")}
                      data-tooltip={t("admin.users.deleteForever")}
                      onclick={() => (deleteTarget = user)}
                    >
                      <Icon icon={TrashIcon} size={13} />
                    </Button>
                  {:else if invitation?.status === "pending"}
                    <Button size="sm" onclick={() => void copyLink.run(invitation)}
                      ><Icon icon={LinkIcon} size={12} />{copiedToken === invitation.token
                        ? t("common.copied")
                        : t("admin.invitations.copyLink")}</Button
                    >
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("admin.invitations.revoke")}
                      data-tooltip={t("admin.invitations.revoke")}
                      disabled={revokingToken === invitation.token}
                      onclick={() => void revoke.run(invitation.token)}><Icon icon={TrashIcon} size={13} /></Button
                    >
                  {/if}
                </div></td
              >
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
  {#if resetTarget}
    <ResetPasswordModal targetUser={resetTarget} onClose={() => (resetTarget = null)} />
  {/if}
  {#if roleTarget}
    {@const target = roleTarget}
    <ConfirmDialog
      title={target.isAdmin
        ? t("admin.users.demoteTitle", { name: target.displayName })
        : t("admin.users.promoteTitle", { name: target.displayName })}
      message={target.isAdmin ? t("admin.users.demoteMessage") : t("admin.users.promoteMessage")}
      confirmLabel={target.isAdmin ? t("admin.users.demote") : t("admin.users.promote")}
      danger="warning"
      pending={changeRole.pending}
      error={changeRole.error}
      onConfirm={() => void changeRole.run(target)}
      onCancel={() => (roleTarget = null)}
    />
  {/if}
  {#if membershipTarget}
    <UserAccessModal targetUser={membershipTarget} onClose={() => (membershipTarget = null)} />
  {/if}
  {#if accessTarget}
    <UserDbAccessModal targetUser={accessTarget} onClose={() => (accessTarget = null)} />
  {/if}
  {#if deleteTarget}
    <DeleteUserModal
      targetUser={deleteTarget}
      users={users.data ?? []}
      onClose={() => (deleteTarget = null)}
      onDeleted={() => {
        deleteTarget = null;
        refreshMembers();
      }}
    />
  {/if}
</div>
