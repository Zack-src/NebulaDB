import { useState } from "react";
import { Modal } from "@/components/overlays/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { ErrorText, Hint } from "@/components/ui/Alert";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useTranslation } from "@/i18n/useTranslation";
import { resetUserPassword } from "@/services/usersApi";
import type { UserSummary } from "@/types";

const MIN_PASSWORD_LENGTH = 8;

export interface ResetPasswordModalProps {
  targetUser: UserSummary;
  onClose: () => void;
}

export function ResetPasswordModal({ targetUser, onClose }: ResetPasswordModalProps) {
  const { t } = useTranslation();
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [reset, setReset] = useState(false);

  const resetPassword = useAsyncAction(async () => {
    await resetUserPassword(targetUser.id, newPassword);
    setReset(true);
  });

  const handleSubmit = () => {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setValidationError(t("acceptInvite.passwordTooShort", { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (newPassword !== confirmation) {
      setValidationError(t("acceptInvite.passwordMismatch"));
      return;
    }
    setValidationError(null);
    void resetPassword.run();
  };

  return (
    <Modal title={t("admin.resetPassword.title", { email: targetUser.email })} onClose={onClose}>
      {reset ? (
        <Hint>{t("admin.resetPassword.success", { email: targetUser.email })}</Hint>
      ) : (
        <>
          <Field
            label={t("changePassword.newLabel")}
            type="password"
            autoFocus
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
          />
          <Field
            label={t("changePassword.confirmLabel")}
            type="password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="new-password"
          />
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={resetPassword.pending || !newPassword || !confirmation}
          >
            {resetPassword.pending ? t("admin.resetPassword.submitting") : t("admin.users.resetPassword")}
          </Button>
          {(validationError ?? resetPassword.error) && <ErrorText>{validationError ?? resetPassword.error}</ErrorText>}
        </>
      )}
    </Modal>
  );
}
