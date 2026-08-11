import { useState, type FormEvent } from "react";
import { LogoMarkIcon } from "@/components/icons/Icons";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { ErrorText } from "@/components/ui/Alert";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useTranslation } from "@/i18n/useTranslation";
import { acceptInvitation } from "@/services/invitationsApi";
import type { Session } from "@/types";

const MIN_PASSWORD_LENGTH = 8;

export interface AcceptInviteProps {
  token: string;
  onLoggedIn: (session: Session) => void;
}

function AcceptInvite({ token, onLoggedIn }: AcceptInviteProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const createAccount = useAsyncAction(async () => {
    onLoggedIn(await acceptInvitation(token, password));
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setValidationError(t("acceptInvite.passwordTooShort", { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirmation) {
      setValidationError(t("acceptInvite.passwordMismatch"));
      return;
    }
    setValidationError(null);
    void createAccount.run();
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form
        className="flex w-full max-w-[340px] flex-col rounded-md border border-border bg-surface p-7 shadow-md"
        onSubmit={handleSubmit}
      >
        <span className="mx-auto mb-3 flex h-[26px] w-[26px] items-center justify-center rounded-sm bg-gradient-to-br from-primary to-[#7c3aed] text-white">
          <LogoMarkIcon size={16} style={{ color: "white" }} />
        </span>
        <h1 className="mb-1 text-center text-lg font-bold">{t("acceptInvite.title")}</h1>
        <p className="mb-5 text-center text-[13px] text-text-muted">{t("acceptInvite.subtitle")}</p>
        <Field
          label={t("login.passwordLabel")}
          type="password"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
        />
        <Field
          label={t("acceptInvite.confirmPassword")}
          type="password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="new-password"
        />
        <Button variant="primary" type="submit" disabled={createAccount.pending || !password || !confirmation}>
          {createAccount.pending ? t("acceptInvite.creating") : t("acceptInvite.createAccount")}
        </Button>
        {(validationError ?? createAccount.error) && <ErrorText>{validationError ?? createAccount.error}</ErrorText>}
      </form>
    </div>
  );
}

export { AcceptInvite };
export default AcceptInvite;
