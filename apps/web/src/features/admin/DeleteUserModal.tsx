import { useState } from "react";
import { Modal } from "@/components/overlays/Modal";
import { Button } from "@/components/ui/Button";
import { ErrorText, Hint } from "@/components/ui/Alert";
import { INPUT_CLASS, SELECT_CLASS } from "@/components/ui/inputStyles";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useTranslation } from "@/i18n/useTranslation";
import { deleteUser } from "@/services/usersApi";
import type { UserSummary } from "@/types";

export interface DeleteUserModalProps {
  targetUser: UserSummary;
  users: UserSummary[];
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * Deleting an account is the one irreversible action in the admin console, and
 * it has a consequence that isn't obvious from the button: projects the person
 * owns have to go somewhere. The server's default is to leave them ownerless —
 * readable by everyone, manageable only by global admins — and there is no
 * route to re-assign an owner afterwards, so this dialog puts the transfer
 * choice in front of the decision rather than after it.
 *
 * Typing the email to confirm is deliberate friction: the list rows are one
 * click apart and the two neighbouring actions (reset password, disable) are
 * both recoverable.
 */
export function DeleteUserModal({ targetUser, users, onClose, onDeleted }: DeleteUserModalProps) {
  const { t } = useTranslation();
  const [confirmation, setConfirmation] = useState("");
  const [transferTo, setTransferTo] = useState("");

  const transferCandidates = users.filter((user) => user.id !== targetUser.id && !user.disabledAt);
  const confirmed = confirmation.trim().toLowerCase() === targetUser.email.toLowerCase();

  const remove = useAsyncAction(async () => {
    await deleteUser(targetUser.id, transferTo || undefined);
    onDeleted();
  });

  return (
    <Modal title={t("admin.deleteUser.title", { email: targetUser.email })} onClose={onClose}>
      <Hint>{t("admin.deleteUser.consequences")}</Hint>

      <label className="mt-4 block text-xs font-semibold text-text-secondary">
        {t("admin.deleteUser.ownedProjects")}
        <select
          className={`${SELECT_CLASS} mt-1 w-full`}
          value={transferTo}
          onChange={(event) => setTransferTo(event.target.value)}
        >
          <option value="">{t("admin.deleteUser.leaveOwnerless")}</option>
          {transferCandidates.map((user) => (
            <option key={user.id} value={user.id}>
              {t("admin.deleteUser.transferTo", { name: user.displayName, email: user.email })}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-4 block text-xs font-semibold text-text-secondary">
        {t("admin.deleteUser.typeToConfirmPrefix")}{" "}
        <span className="font-mono text-text">{targetUser.email}</span>{" "}
        {t("admin.deleteUser.typeToConfirmSuffix")}
        <input
          className={`${INPUT_CLASS} mt-1 w-full`}
          value={confirmation}
          autoFocus
          autoComplete="off"
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </label>

      <Button variant="danger" className="mt-4" onClick={() => void remove.run()} disabled={remove.pending || !confirmed}>
        {remove.pending ? t("common.deleting") : t("admin.deleteUser.confirm")}
      </Button>
      {remove.error && <ErrorText>{remove.error}</ErrorText>}
    </Modal>
  );
}
