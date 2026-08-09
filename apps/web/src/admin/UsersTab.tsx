import { useCallback, useEffect, useState } from "react";
import { KeyIcon, LogOutIcon, RestoreIcon, TrashIcon } from "../Icons.js";
import { Button } from "../ui/Button.js";
import { Badge } from "../ui/Badge.js";
import { ErrorText } from "../ui/Alert.js";
import { List, ListMain, ListRow, EmptyState } from "../ui/List.js";
import type { UserSummary } from "../types.js";
import { ResetPasswordModal } from "./ResetPasswordModal.js";
import { DeleteUserModal } from "./DeleteUserModal.js";

export function UsersTab() {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<UserSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/users")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`list failed (${r.status})`))))
      .then(setUsers)
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(refresh, [refresh]);

  /**
   * Disabling is the reversible half of offboarding and the one to reach for
   * first: the account stops working immediately (its sessions are deleted
   * server-side and any open WebSocket is closed), but nothing it owns is
   * touched, so the decision can be walked back.
   */
  async function setDisabled(user: UserSummary, disabled: boolean) {
    setBusyId(user.id);
    setError(null);
    try {
      const res = await fetch(`/api/users/${user.id}/disabled`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `request failed (${res.status})`);
      }
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      {error && <ErrorText>{error}</ErrorText>}
      {users.length === 0 ? (
        <EmptyState>Aucun utilisateur.</EmptyState>
      ) : (
        <List>
          {users.map((u) => {
            const disabled = Boolean(u.disabledAt);
            return (
              <ListRow key={u.id}>
                <ListMain>
                  <span className={disabled ? "line-through text-text-muted" : undefined}>{u.displayName}</span>
                  <span className="text-text-muted">{u.email}</span>
                  {u.isAdmin && <Badge tone="admin">Admin</Badge>}
                  {disabled && <Badge tone="danger">Désactivé</Badge>}
                </ListMain>
                <span className="text-xs text-text-muted">{u.createdAt}</span>
                <Button variant="ghost" size="icon" data-tooltip="Réinitialiser le mot de passe" onClick={() => setResetTarget(u)}>
                  <KeyIcon size={13} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={busyId === u.id}
                  data-tooltip={disabled ? "Réactiver ce compte" : "Désactiver ce compte"}
                  onClick={() => void setDisabled(u, !disabled)}
                >
                  {disabled ? <RestoreIcon size={13} /> : <LogOutIcon size={13} />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  data-tooltip="Supprimer définitivement ce compte"
                  onClick={() => setDeleteTarget(u)}
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
          users={users}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
