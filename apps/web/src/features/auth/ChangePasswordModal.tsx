import { useState } from "react";
import { Modal } from "@/components/overlays/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { ErrorText, Hint } from "@/components/ui/Alert";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useTranslation } from "@/i18n/useTranslation";
import { changeMyPassword } from "@/services/usersApi";

const MIN_PASSWORD_LENGTH = 8;

/** Self-service password change — requires the current password, unlike the admin reset in the admin console. */
function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  const changePassword = useAsyncAction(async () => {
    await changeMyPassword(currentPassword, newPassword);
    setChanged(true);
  });

  // A real <form> submit handler, so Enter in any of the three fields submits
  // — the browser default every password dialog is expected to honour, and
  // which a bare onClick on the button does not provide.
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setValidationError(t("changePassword.tooShort", { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (newPassword !== confirmation) {
      setValidationError(t("acceptInvite.passwordMismatch"));
      return;
    }
    setValidationError(null);
    void changePassword.run();
  };

  return (
    <Modal title={t("changePassword.title")} onClose={onClose}>
      {changed ? (
        <Hint>{t("changePassword.success")}</Hint>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <Field
            label={t("changePassword.currentLabel")}
            type="password"
            autoFocus
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
          />
          <Field
            label={t("changePassword.newLabel")}
            type="password"
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
            type="submit"
            disabled={changePassword.pending || !currentPassword || !newPassword || !confirmation}
          >
            {changePassword.pending ? t("changePassword.submitting") : t("changePassword.title")}
          </Button>
          {(validationError ?? changePassword.error) && (
            <ErrorText>{validationError ?? changePassword.error}</ErrorText>
          )}
        </form>
      )}
    </Modal>
  );
}

export { ChangePasswordModal };
export default ChangePasswordModal;
