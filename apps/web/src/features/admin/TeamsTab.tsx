import { useState } from "react";
import { PlusIcon, TrashIcon, UsersIcon } from "@/components/icons/Icons";
import { Button } from "@/components/ui/Button";
import { ErrorText } from "@/components/ui/Alert";
import { List, ListMain, ListRow, EmptyState } from "@/components/ui/List";
import { INPUT_CLASS } from "@/components/ui/inputStyles";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useTranslation } from "@/i18n/useTranslation";
import { createTeam, deleteTeam, fetchTeams } from "@/services/teamsApi";
import { TeamDetailView } from "@/features/admin/TeamDetailView";

export function TeamsTab() {
  const { t } = useTranslation();
  const teams = useAsyncResource(fetchTeams);
  const [newTeamName, setNewTeamName] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const addTeam = useAsyncAction(async () => {
    await createTeam(newTeamName.trim());
    setNewTeamName("");
    teams.reload();
  });

  const removeTeam = useAsyncAction(async (teamId: string) => {
    await deleteTeam(teamId);
    teams.reload();
  });

  const handleCreate = () => {
    if (newTeamName.trim()) void addTeam.run();
  };

  const rows = teams.data ?? [];
  const error = teams.error ?? addTeam.error ?? removeTeam.error;

  return (
    <div>
      <div className="mb-7 flex max-w-[420px] gap-2">
        <input
          className={`${INPUT_CLASS} flex-1`}
          placeholder={t("admin.teams.namePlaceholder")}
          value={newTeamName}
          onChange={(event) => setNewTeamName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && handleCreate()}
        />
        <Button variant="primary" onClick={handleCreate} disabled={addTeam.pending || !newTeamName.trim()}>
          <PlusIcon size={14} /> {t("admin.teams.create")}
        </Button>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      {rows.length === 0 ? (
        <EmptyState>{teams.loading ? t("common.loading") : t("admin.teams.empty")}</EmptyState>
      ) : (
        <List>
          {rows.map((team) => (
            <ListRow key={team.id}>
              <ListMain as="button" onClick={() => setSelectedTeamId(team.id)}>
                <UsersIcon size={13} className="text-text-muted" />
                <span>{team.name}</span>
                <span className="text-text-muted">{t("admin.teams.memberCount", { count: team.memberCount })}</span>
              </ListMain>
              <Button
                variant="ghost"
                size="icon"
                data-tooltip={t("admin.teams.delete")}
                onClick={() => void removeTeam.run(team.id)}
              >
                <TrashIcon size={13} />
              </Button>
            </ListRow>
          ))}
        </List>
      )}
      {selectedTeamId && (
        <TeamDetailView teamId={selectedTeamId} onClose={() => setSelectedTeamId(null)} onChanged={teams.reload} />
      )}
    </div>
  );
}
