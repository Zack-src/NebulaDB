import { useState } from "react";
import { KeyIcon, LogOutIcon, RestoreIcon, TrashIcon } from "@/components/icons/Icons";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ErrorText } from "@/components/ui/Alert";
import { List, ListMain, ListRow, EmptyState } from "@/components/ui/List";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { formatDate } from "@/i18n/formatters";
import { useTranslation } from "@/i18n/useTranslation";
import { fetchUsers, setUserDisabled } from "@/services/usersApi";
import type { UserSummary } from "@/types";
import { ResetPasswordModal } from "@/features/admin/ResetPasswordModal";
import { DeleteUserModal } from "@/features/admin/DeleteUserModal";

export function UsersTab() {
  const { t, locale } = useTranslation();
  const users = useAsyncResource(fetchUsers);
  const [resetTarget, setResetTarget] = useState<UserSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserSummary | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  /**
   * Disabling is the reversible half of offboarding and the one to reach for
   * first: the account stops working immediately (its sessions are deleted
   * server-side and any open WebSocket is closed), but nothing it owns is
   * touched, so the decision can be walked back.
   */
  const toggleDisabled = useAsyncAction(async (user: UserSummary, disabled: boolean) => {
    setPendingUserId(user.id);
    try {
      await setUserDisabled(user.id, disabled);
      users.reload();
    } finally {
      setPendingUserId(null);
    }
  });

  const rows = users.data ?? [];

  return (
    <div>
      {(users.error ?? toggleDisabled.error) && <ErrorText>{users.error ?? toggleDisabled.error}</ErrorText>}
      {rows.length === 0 ? (
        <EmptyState>{users.loading ? t("common.loading") : t("admin.users.empty")}</EmptyState>
      ) : (
        <List>
          {rows.map((user) => {
            const disabled = Boolean(user.disabledAt);
            return (
              <ListRow key={user.id}>
                <ListMain>
                  <span className={disabled ? "line-through text-text-muted" : undefined}>{user.displayName}</span>
                  <span className="text-text-muted">{user.email}</span>
                  {user.isAdmin && <Badge tone="admin">{t("common.admin")}</Badge>}
                  {disabled && <Badge tone="danger">{t("admin.users.disabled")}</Badge>}
                </ListMain>
                <span className="text-xs text-text-muted">{formatDate(user.createdAt, locale)}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  data-tooltip={t("admin.users.resetPassword")}
                  onClick={() => setResetTarget(user)}
                >
                  <KeyIcon size={13} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={pendingUserId === user.id}
                  data-tooltip={disabled ? t("admin.users.enable") : t("admin.users.disable")}
                  onClick={() => void toggleDisabled.run(user, !disabled)}
                >
                  {disabled ? <RestoreIcon size={13} /> : <LogOutIcon size={13} />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  data-tooltip={t("admin.users.deleteForever")}
                  onClick={() => setDeleteTarget(user)}
                >
                  <TrashIcon size={13} />
                </Button>
              </ListRow>
            );
          })}
        </List>
      )}
      {resetTarget && <ResetPasswordModal targetUser={resetTarget} onClose={() => setResetTarget(null)} />}
      {deleteTarget && (
        <DeleteUserModal
          targetUser={deleteTarget}
          users={rows}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            users.reload();
          }}
        />
      )}
    </div>
  );
}
