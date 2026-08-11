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
import { login } from "@/services/authApi";
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

  const signIn = useAsyncAction(async () => {
    onLoggedIn(await login({ email: email.trim(), password, remember }));
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
        <Card variant="glow" className="w-full shadow-2xl glass-panel">
          <CardHeader className="text-center pb-4 border-b border-border/40">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent-purple text-white shadow-md glow-indigo">
              <LogoMarkIcon size={20} style={{ color: "white" }} />
            </div>
            <h1 className="text-xl font-extrabold tracking-tight">{APP_NAME}</h1>
            <p className="text-xs text-text-muted mt-1">{t("login.tagline")}</p>
          </CardHeader>

          <CardBody className="p-6 space-y-5">
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
                  type="submit"
                  disabled={signIn.pending || !email.trim() || !password}
                  className="w-full py-2.5"
                >
                  {signIn.pending ? t("login.signingIn") : t("login.signIn")}
                </Button>

                {signIn.error && <ErrorText>{signIn.error}</ErrorText>}
              </form>
            )}

            {tab === "invite" && (
              <div className="space-y-4 text-xs text-text-secondary">
                <p>{t("login.inviteOnly")}</p>
                <div className="p-3.5 rounded-lg bg-surface-raised border border-border/60 space-y-2">
                  <div className="font-semibold text-text flex items-center gap-1.5">
                    <KeyIcon size={14} className="text-warning" /> {t("login.haveInviteLink")}
                  </div>
                  <p className="text-[11px] text-text-muted">{t("login.haveInviteLinkHint")}</p>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export default Login;
