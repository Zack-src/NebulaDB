import { useState } from "react";
import { Modal } from "@/components/overlays/Modal";
import { PlusIcon, TrashIcon } from "@/components/icons/Icons";
import { Button } from "@/components/ui/Button";
import { Hint, ErrorText } from "@/components/ui/Alert";
import { List, ListMain, ListRow, EmptyState } from "@/components/ui/List";
import { SELECT_CLASS, SELECT_SM_CLASS } from "@/components/ui/inputStyles";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { useTranslation } from "@/i18n/useTranslation";
import { fetchProjectTeams, grantProjectTeam, revokeProjectTeam } from "@/services/projectsApi";
import { fetchTeams } from "@/services/teamsApi";
import type { PermissionLevel, ProjectSummary, TranslationKeyOf } from "@/types";

const PERMISSION_LEVELS: PermissionLevel[] = ["view", "edit", "administrator"];

const PERMISSION_LABEL_KEY = {
  view: "permission.view",
  edit: "permission.edit",
  administrator: "permission.administrator",
} as const satisfies Record<PermissionLevel, TranslationKeyOf>;

export interface ProjectTeamsModalProps {
  project: ProjectSummary;
  onClose: () => void;
}

/**
 * Assigns teams (and a permission level each) to a project — reachable by
 * anyone who can manage that project, not just global admins.
 */
function ProjectTeamsModal({ project, onClose }: ProjectTeamsModalProps) {
  const { t } = useTranslation();
  const grants = useAsyncResource(() => fetchProjectTeams(project.id), [project.id]);
  const teams = useAsyncResource(fetchTeams);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [selectedPermission, setSelectedPermission] = useState<PermissionLevel>("view");

  const assignTeam = useAsyncAction(async (teamId: string, permission: PermissionLevel) => {
    await grantProjectTeam(project.id, teamId, permission);
    grants.reload();
  });

  const unassignTeam = useAsyncAction(async (teamId: string) => {
    await revokeProjectTeam(project.id, teamId);
    grants.reload();
  });

  const handleAssign = async () => {
    if (!selectedTeamId) return;
    if (await assignTeam.run(selectedTeamId, selectedPermission)) setSelectedTeamId("");
  };

  const rows = grants.data ?? [];
  const assignableTeams = (teams.data ?? []).filter((team) => !rows.some((grant) => grant.teamId === team.id));
  const error = grants.error ?? assignTeam.error ?? unassignTeam.error;

  const renderPermissionOptions = () =>
    PERMISSION_LEVELS.map((level) => (
      <option key={level} value={level}>
        {t(PERMISSION_LABEL_KEY[level])}
      </option>
    ));

  return (
    <Modal title={t("teams.modalTitle", { name: project.name })} onClose={onClose}>
      <Hint>{t("teams.visibilityNote")}</Hint>
      <div className="mb-7 flex max-w-[420px] gap-2">
        <select
          className={SELECT_CLASS}
          value={selectedTeamId}
          onChange={(event) => setSelectedTeamId(event.target.value)}
        >
          <option value="">{t("teams.assignPlaceholder")}</option>
          {assignableTeams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
        <select
          className={SELECT_CLASS}
          value={selectedPermission}
          onChange={(event) => setSelectedPermission(event.target.value as PermissionLevel)}
        >
          {renderPermissionOptions()}
        </select>
        <Button variant="primary" onClick={() => void handleAssign()} disabled={!selectedTeamId}>
          <PlusIcon size={14} /> {t("teams.assign")}
        </Button>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      {rows.length === 0 ? (
        <EmptyState>{t("teams.noneAssigned")}</EmptyState>
      ) : (
        <List>
          {rows.map((grant) => (
            <ListRow key={grant.teamId}>
              <ListMain>
                <span>{grant.teamName}</span>
              </ListMain>
              <select
                className={SELECT_SM_CLASS}
                value={grant.permission}
                onChange={(event) => void assignTeam.run(grant.teamId, event.target.value as PermissionLevel)}
              >
                {renderPermissionOptions()}
              </select>
              <Button
                variant="ghost"
                size="icon"
                data-tooltip={t("teams.unassign")}
                onClick={() => void unassignTeam.run(grant.teamId)}
              >
                <TrashIcon size={13} />
              </Button>
            </ListRow>
          ))}
        </List>
      )}
    </Modal>
  );
}

export { ProjectTeamsModal };
export default ProjectTeamsModal;
