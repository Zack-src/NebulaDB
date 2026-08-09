import { useEffect, useState } from "react";
import { PlusIcon, TrashIcon, UsersIcon } from "../Icons.js";
import { Button } from "../ui/Button.js";
import { ErrorText } from "../ui/Alert.js";
import { List, ListMain, ListRow, EmptyState } from "../ui/List.js";
import { INPUT_CLASS } from "../ui/inputStyles.js";
import type { TeamSummary } from "../types.js";
import { TeamDetailView } from "./TeamDetailView.js";

export function TeamsTab() {
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const refresh = () => {
    fetch("/api/teams")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`list failed (${r.status})`))))
      .then(setTeams)
      .catch((err) => setError((err as Error).message));
  };

  useEffect(refresh, []);

  const create = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        setNewName("");
        refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Create failed (${res.status})`);
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/teams/${id}`, { method: "DELETE" });
    refresh();
  };

  return (
    <div>
      <div className="mb-7 flex max-w-[420px] gap-2">
        <input
          className={`${INPUT_CLASS} flex-1`}
          placeholder="Nom de la nouvelle équipe"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
        <Button variant="primary" onClick={create} disabled={busy || !newName.trim()}>
          <PlusIcon size={14} /> Create team
        </Button>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      {teams.length === 0 ? (
        <EmptyState>Aucune équipe pour le moment.</EmptyState>
      ) : (
        <List>
          {teams.map((t) => (
            <ListRow key={t.id}>
              <ListMain as="button" onClick={() => setSelectedTeamId(t.id)}>
                <UsersIcon size={13} className="text-text-muted" />
                <span>{t.name}</span>
                <span className="text-text-muted">
                  {t.memberCount} member{t.memberCount === 1 ? "" : "s"}
                </span>
              </ListMain>
              <Button variant="ghost" size="icon" data-tooltip="Supprimer l'équipe" onClick={() => remove(t.id)}>
                <TrashIcon size={13} />
              </Button>
            </ListRow>
          ))}
        </List>
      )}
      {selectedTeamId && (
        <TeamDetailView teamId={selectedTeamId} onClose={() => setSelectedTeamId(null)} onChanged={refresh} />
      )}
    </div>
  );
}
