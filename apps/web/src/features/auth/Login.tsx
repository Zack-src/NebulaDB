import { useState, type FormEvent } from "react";
import { APP_NAME } from "@/components/layout/Navbar";
import { LogoMarkIcon, KeyIcon } from "@/components/icons/Icons";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { ErrorText } from "@/components/ui/Alert";
import { Tabs } from "@/components/ui/Tabs";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { CHECKBOX_CLASS } from "@/components/ui/inputStyles";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useTranslation } from "@/i18n/useTranslation";
import { login, verifyTotpLogin } from "@/services/authApi";
import type { Session } from "@/types";

export interface LoginProps {
  onLoggedIn: (session: Session) => void;
}

type LoginTab = "login" | "invite";

export function Login({ onLoggedIn }: LoginProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<LoginTab>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Defaults to the historical 30-day session. Unchecking gives a 12-hour one
  // in a cookie the browser drops when it closes — for a shared machine.
  const [remember, setRemember] = useState(true);

  // Set once the password step succeeds on a 2FA-enabled account — its
  // presence is what switches the form below to the verification step, so
  // clearing it (the "back to login" link) is enough to return to step one.
  const [mfaToken, setMfaToken] = useState<string | null>(null);

  const signIn = useAsyncAction(async () => {
    const result = await login({ email: email.trim(), password, remember });
    if ("mfaRequired" in result) {
      setMfaToken(result.mfaToken);
      return;
    }
    onLoggedIn(result);
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
    void signIn.run();
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center p-6 bg-bg overflow-hidden gradient-bg-hero">
      {/* Glow backdrop shapes */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] bg-primary/20 blur-[130px] rounded-full pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-[300px] h-[300px] bg-accent-purple/15 blur-[100px] rounded-full pointer-events-none" />

      <div className="relative w-full max-w-[420px] flex flex-col gap-4">
        <Card variant="glow" className="w-full shadow-xl glass-panel">
          <CardHeader className="border-b border-border/40 pb-4 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent-purple text-white shadow-md">
              <LogoMarkIcon size={20} style={{ color: "white" }} />
            </div>
            <h1 className="text-xl font-extrabold tracking-tight">{APP_NAME}</h1>
            <p className="mt-1 text-xs text-text-muted">{t("login.tagline")}</p>
          </CardHeader>

          <CardBody className="space-y-5">
            {mfaToken ? (
              <MfaStep mfaToken={mfaToken} onBack={() => setMfaToken(null)} onVerified={onLoggedIn} />
            ) : (
              <>
                <Tabs
                  variant="boxed"
                  tabs={[
                    { id: "login", label: t("login.tab.signIn") },
                    { id: "invite", label: t("login.tab.invite") },
                  ]}
                  activeTab={tab}
                  onChange={(next) => {
                    setTab(next as LoginTab);
                    signIn.clearError();
                  }}
                />

                {tab === "login" && (
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <Field
                      label={t("login.emailLabel")}
                      type="email"
                      placeholder={t("login.emailPlaceholder")}
                      autoFocus
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="username"
                    />
                    <Field
                      label={t("login.passwordLabel")}
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                    />

                    <label className="flex items-start gap-2 text-xs text-text-secondary cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className={`${CHECKBOX_CLASS} mt-px`}
                        checked={remember}
                        onChange={(event) => setRemember(event.target.checked)}
                      />
                      <span>
                        {t("login.rememberMe")}
                        <span className="block text-[11px] text-text-muted">{t("login.rememberMeHint")}</span>
                      </span>
                    </label>

                    <Button
                      variant="primary"
                      size="lg"
                      type="submit"
                      disabled={signIn.pending || !email.trim() || !password}
                      className="w-full"
                    >
                      {signIn.pending ? t("login.signingIn") : t("login.signIn")}
                    </Button>

                    {signIn.error && <ErrorText>{signIn.error}</ErrorText>}
                  </form>
                )}

                {tab === "invite" && (
                  <div className="space-y-4 text-xs text-text-secondary">
                    <p>{t("login.inviteOnly")}</p>
                    <div className="space-y-2 rounded-lg border border-border bg-surface-raised p-3.5">
                      <div className="flex items-center gap-1.5 font-semibold text-text">
                        <KeyIcon size={14} className="text-warning" /> {t("login.haveInviteLink")}
                      </div>
                      <p className="text-[11px] text-text-muted">{t("login.haveInviteLinkHint")}</p>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

/** Second step of a 2FA login — a live authenticator code, or a backup code as a lost-device fallback. */
function MfaStep(props: { mfaToken: string; onBack: () => void; onVerified: (session: Session) => void }) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);

  const verify = useAsyncAction(async () => {
    props.onVerified(await verifyTotpLogin(props.mfaToken, code.trim()));
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return;
    void verify.run();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h2 className="text-sm font-bold text-text">{t("login.mfa.title")}</h2>
        <p className="mt-1 text-xs text-text-muted">{t("login.mfa.subtitle")}</p>
      </div>

      <Field
        label={useBackupCode ? t("totp.disableCodeLabel") : t("totp.codeLabel")}
        type="text"
        autoFocus
        autoComplete="one-time-code"
        placeholder={useBackupCode ? t("login.mfa.backupCodePlaceholder") : t("login.mfa.codePlaceholder")}
        value={code}
        onChange={(event) =>
          setCode(useBackupCode ? event.target.value : event.target.value.replace(/[^0-9]/g, "").slice(0, 6))
        }
      />

      <Button variant="primary" size="lg" type="submit" disabled={verify.pending || !code.trim()} className="w-full">
        {verify.pending ? t("login.mfa.verifying") : t("login.mfa.verify")}
      </Button>

      {verify.error && <ErrorText>{verify.error}</ErrorText>}

      <div className="flex items-center justify-between text-[11px]">
        <button
          type="button"
          className="text-text-muted hover:text-text underline-offset-2 hover:underline"
          onClick={props.onBack}
        >
          {t("login.mfa.back")}
        </button>
        <button
          type="button"
          className="text-text-muted hover:text-text underline-offset-2 hover:underline"
          onClick={() => {
            setUseBackupCode((prev) => !prev);
            setCode("");
            verify.clearError();
          }}
        >
          {useBackupCode ? t("login.mfa.useAuthenticatorCode") : t("login.mfa.useBackupCode")}
        </button>
      </div>
    </form>
  );
}

export default Login;
