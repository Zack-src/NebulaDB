import { useEffect, useState } from "react";
import { Modal } from "../Modal.js";
import { PlusIcon, TrashIcon } from "../Icons.js";
import { Button } from "../ui/Button.js";
import { ErrorText } from "../ui/Alert.js";
import { List, ListMain, ListRow, EmptyState } from "../ui/List.js";
import { SELECT_CLASS } from "../ui/inputStyles.js";
import type { TeamDetail, UserSummary } from "../types.js";

export function TeamDetailView(props: { teamId: string; onClose: () => void; onChanged: () => void }) {
  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [pickUserId, setPickUserId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    fetch(`/api/teams/${props.teamId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`load failed (${r.status})`))))
      .then(setTeam)
      .catch((err) => setError((err as Error).message));
  };

  useEffect(refresh, [props.teamId]);
  useEffect(() => {
    fetch("/api/users")
      .then((r) => (r.ok ? r.json() : []))
      .then(setUsers)
      .catch(() => {});
  }, []);

  const addMember = async () => {
    if (!pickUserId) return;
    await fetch(`/api/teams/${props.teamId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: pickUserId }),
    });
    setPickUserId("");
    refresh();
    props.onChanged();
  };

  const removeMember = async (userId: string) => {
    await fetch(`/api/teams/${props.teamId}/members/${userId}`, { method: "DELETE" });
    refresh();
    props.onChanged();
  };

  const availableUsers = users.filter((u) => !team?.members.some((m) => m.id === u.id));

  return (
    <Modal title={team ? `Équipe : ${team.name}` : "Équipe"} onClose={props.onClose}>
      {error && <ErrorText>{error}</ErrorText>}
      {team && (
        <>
          <div className="mb-7 flex max-w-[420px] gap-2">
            <select className={`${SELECT_CLASS} flex-1`} value={pickUserId} onChange={(e) => setPickUserId(e.target.value)}>
              <option value="">Ajouter un membre…</option>
              {availableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName} ({u.email})
                </option>
              ))}
            </select>
            <Button variant="primary" onClick={addMember} disabled={!pickUserId}>
              <PlusIcon size={14} /> Ajouter
            </Button>
          </div>
          {team.members.length === 0 ? (
            <EmptyState>Aucun membre pour le moment.</EmptyState>
          ) : (
            <List>
              {team.members.map((m) => (
                <ListRow key={m.id}>
                  <ListMain>
                    <span>{m.displayName}</span>
                    <span className="text-text-muted">{m.email}</span>
                  </ListMain>
                  <Button variant="ghost" size="icon" data-tooltip="Retirer de l'équipe" onClick={() => removeMember(m.id)}>
                    <TrashIcon size={13} />
                  </Button>
                </ListRow>
              ))}
            </List>
          )}
        </>
      )}
    </Modal>
  );
}
