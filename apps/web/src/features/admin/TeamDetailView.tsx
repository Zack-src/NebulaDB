import { useState } from "react";
import { Modal } from "@/components/overlays/Modal";
import { PlusIcon, TrashIcon } from "@/components/icons/Icons";
import { Button } from "@/components/ui/Button";
import { ErrorText } from "@/components/ui/Alert";
import { List, ListMain, ListRow, EmptyState } from "@/components/ui/List";
import { SELECT_CLASS } from "@/components/ui/inputStyles";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useTranslation } from "@/i18n/useTranslation";
import { addTeamMember, fetchTeam, removeTeamMember } from "@/services/teamsApi";
import { fetchUsers } from "@/services/usersApi";

export interface TeamDetailViewProps {
  teamId: string;
  onClose: () => void;
  onChanged: () => void;
}

export function TeamDetailView({ teamId, onClose, onChanged }: TeamDetailViewProps) {
  const { t } = useTranslation();
  const team = useAsyncResource(() => fetchTeam(teamId), [teamId]);
  const users = useAsyncResource(fetchUsers);
  const [selectedUserId, setSelectedUserId] = useState("");

  const applyMembershipChange = () => {
    team.reload();
    onChanged();
  };

  const addMember = useAsyncAction(async () => {
    await addTeamMember(teamId, selectedUserId);
    setSelectedUserId("");
    applyMembershipChange();
  });

  const removeMember = useAsyncAction(async (userId: string) => {
    await removeTeamMember(teamId, userId);
    applyMembershipChange();
  });

  const members = team.data?.members ?? [];
  const assignableUsers = (users.data ?? []).filter((user) => !members.some((member) => member.id === user.id));
  const error = team.error ?? addMember.error ?? removeMember.error;

  return (
    <Modal title={team.data ? t("admin.teams.detailTitle", { name: team.data.name }) : t("admin.teams.one")} onClose={onClose}>
      {error && <ErrorText>{error}</ErrorText>}
      {team.data && (
        <>
          <div className="mb-7 flex max-w-[420px] gap-2">
            <select
              className={`${SELECT_CLASS} flex-1`}
              value={selectedUserId}
              onChange={(event) => setSelectedUserId(event.target.value)}
            >
              <option value="">{t("admin.teams.addMemberPlaceholder")}</option>
              {assignableUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName} ({user.email})
                </option>
              ))}
            </select>
            <Button variant="primary" onClick={() => void addMember.run()} disabled={!selectedUserId}>
              <PlusIcon size={14} /> {t("common.add")}
            </Button>
          </div>
          {members.length === 0 ? (
            <EmptyState>{t("admin.teams.noMembers")}</EmptyState>
          ) : (
            <List>
              {members.map((member) => (
                <ListRow key={member.id}>
                  <ListMain>
                    <span>{member.displayName}</span>
                    <span className="text-text-muted">{member.email}</span>
                  </ListMain>
                  <Button
                    variant="ghost"
                    size="icon"
                    data-tooltip={t("admin.teams.removeMember")}
                    onClick={() => void removeMember.run(member.id)}
                  >
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
