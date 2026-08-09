import { useState } from "react";
import { LogoMarkIcon, ChevronLeftIcon, KeyIcon } from "./Icons.js";
import { Button } from "./ui/Button.js";
import { Field } from "./ui/Field.js";
import { ErrorText } from "./ui/Alert.js";
import { Tabs } from "./ui/Tabs.js";
import { Card, CardBody, CardHeader } from "./ui/Card.js";
import { CHECKBOX_CLASS } from "./ui/inputStyles.js";
import type { Session } from "./types.js";

export interface LoginProps {
  onLoggedIn: (session: Session) => void;
  onBackToLanding?: () => void;
}

export function Login({ onLoggedIn, onBackToLanding }: LoginProps) {
  const [tab, setTab] = useState<"login" | "invite">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Defaults to the historical 30-day session. Unchecking gives a 12-hour one
  // in a cookie the browser drops when it closes — for a shared machine.
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, remember }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        onLoggedIn(data as Session);
      } else {
        setError(data.error ?? `La connexion a échoué (${res.status})`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center p-6 bg-bg overflow-hidden gradient-bg-hero">
      {/* Glow backdrop shapes */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] bg-primary/20 blur-[130px] rounded-full pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-[300px] h-[300px] bg-accent-purple/15 blur-[100px] rounded-full pointer-events-none" />

      <div className="relative w-full max-w-[420px] flex flex-col gap-4">
        {onBackToLanding && (
          <button
            onClick={onBackToLanding}
            className="self-start inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text transition-colors mb-1"
          >
            <ChevronLeftIcon size={14} /> Retour à la Landing Page
          </button>
        )}

        <Card variant="glow" className="w-full shadow-2xl glass-panel">
          <CardHeader className="text-center pb-4 border-b border-border/40">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent-purple text-white shadow-md glow-indigo">
              <LogoMarkIcon size={20} style={{ color: "white" }} />
            </div>
            <h1 className="text-xl font-extrabold tracking-tight">AthanorDB</h1>
            <p className="text-xs text-text-muted mt-1">
              Plateforme d'édition de schémas DBML & Collaboration
            </p>
          </CardHeader>

          <CardBody className="p-6 space-y-5">
            {/* Tabs Selector */}
            <Tabs
              variant="boxed"
              tabs={[
                { id: "login", label: "Connexion" },
                { id: "invite", label: "Rejoindre via Invitation" },
              ]}
              activeTab={tab}
              onChange={(t) => {
                setTab(t);
                setError(null);
              }}
            />

            {/* Login Tab */}
            {tab === "login" && (
              <form onSubmit={submitLogin} className="space-y-4">
                <Field
                  label="Email"
                  type="email"
                  placeholder="nom@entreprise.com"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                />
                <Field
                  label="Mot de passe"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />

                <label className="flex items-start gap-2 text-xs text-text-secondary cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className={`${CHECKBOX_CLASS} mt-px`}
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  <span>
                    Rester connecté 30 jours
                    <span className="block text-[11px] text-text-muted">
                      Décochez sur un poste partagé : la session dure alors 12 h et se ferme avec le navigateur.
                    </span>
                  </span>
                </label>

                <Button
                  variant="primary"
                  type="submit"
                  disabled={busy || !email.trim() || !password}
                  className="w-full py-2.5"
                >
                  {busy ? "Connexion en cours…" : "Se Connecter"}
                </Button>

                {error && <ErrorText>{error}</ErrorText>}
              </form>
            )}

            {/* Invite Code Tab */}
            {tab === "invite" && (
              <div className="space-y-4 text-xs text-text-secondary">
                <p>
                  Les nouveaux comptes se font sur invitation d'un administrateur ou d'une équipe.
                </p>
                <div className="p-3.5 rounded-lg bg-surface-raised border border-border/60 space-y-2">
                  <div className="font-semibold text-text flex items-center gap-1.5">
                    <KeyIcon size={14} className="text-warning" /> Vous possédez un lien d'invitation ?
                  </div>
                  <p className="text-[11px] text-text-muted">
                    Ouvrez directement le lien reçu par email pour définir votre mot de passe et créer votre compte gratuitement.
                  </p>
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

