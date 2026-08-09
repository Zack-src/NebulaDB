import { Button } from "../ui/Button.js";
import { Field } from "../ui/Field.js";
import { Badge } from "../ui/Badge.js";
import { Card } from "../ui/Card.js";
import { Tabs } from "../ui/Tabs.js";
import { KeyIcon, CheckIcon, SparklesIcon } from "../Icons.js";
import type { Session } from "../types.js";
import { ActiveSessions } from "./ActiveSessions.js";
import { PersonalData } from "./PersonalData.js";
import type { useSettingsPanelState, SettingsTab } from "./useSettingsPanelState.js";

const THEME_PRESETS = [
  { id: "obsidian", name: "Obsidian Sombre", color: "bg-[#090a0f] border-primary", available: true },
  { id: "midnight", name: "Midnight Ardoise", color: "bg-[#0f172a] border-blue-500", available: false },
  { id: "emerald", name: "Emerald Cyber", color: "bg-[#064e3b] border-emerald-500", available: false },
  { id: "light", name: "Clair Moderne", color: "bg-[#f8fafc] border-slate-400", available: false },
] as const;

export interface SettingsTabContentProps {
  tab: SettingsTab;
  session: Session;
  state: ReturnType<typeof useSettingsPanelState>;
}

/**
 * The six settings tab bodies, shared by `SettingsPage` (full page) and
 * `SettingsModal` (in-editor overlay) — same content, two different shells.
 * Only the `tab` prop changes what's rendered; the surrounding chrome
 * (sidebar nav, header) stays with each caller since it differs on purpose.
 */
export function SettingsTabContent({ tab, session, state }: SettingsTabContentProps) {
  if (tab === "profile") {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-bold text-text mb-1">Informations du profil</h2>
          <p className="text-xs text-text-muted">Gérez vos identifiants d'accès et votre nom d'affichage.</p>
        </div>

        <form onSubmit={state.handleSaveDisplayName} className="space-y-4 max-w-md">
          <Field label="Adresse email (identifiant)" type="email" value={session.email} disabled readOnly />
          <Field
            label="Nom d'affichage"
            type="text"
            value={state.displayName}
            onChange={(e) => state.setDisplayName(e.target.value)}
          />
          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="primary"
              type="submit"
              disabled={state.savingName || !state.displayName.trim() || state.displayName === session.displayName}
            >
              {state.savingName ? "Enregistrement…" : "Enregistrer les modifications"}
            </Button>
            {state.nameSavedSuccess && (
              <span className="text-xs text-success font-semibold flex items-center gap-1">
                <CheckIcon size={14} /> Mis à jour !
              </span>
            )}
          </div>
        </form>

        <div className="pt-6 border-t border-border/60">
          <h3 className="text-sm font-bold text-text mb-1">Sécurité de l'accès</h3>
          <p className="text-xs text-text-muted mb-4">Modifiez votre mot de passe pour sécuriser votre compte.</p>
          <Button variant="outline" onClick={() => state.setShowChangePassword(true)} className="gap-2 text-xs">
            <KeyIcon size={14} /> Modifier le mot de passe
          </Button>
        </div>

        <ActiveSessions />
        <PersonalData />
      </div>
    );
  }

  if (tab === "appearance") {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-bold text-text mb-1">Apparence & thèmes visuels</h2>
          <p className="text-xs text-text-muted">Personnalisez l'esthétique globale d'AthanorDB.</p>
        </div>

        <div className="space-y-3">
          <label className="text-xs font-semibold text-text">Préréglage de couleur</label>
          <div className="grid grid-cols-2 gap-3">
            {THEME_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={!p.available}
                onClick={() => state.setThemePreset(p.id)}
                data-tooltip={p.available ? undefined : "Bientôt disponible"}
                className={`p-3.5 rounded-xl border flex items-center justify-between text-xs transition-all ${
                  !p.available
                    ? "opacity-40 cursor-not-allowed border-border/40"
                    : state.themePreset === p.id
                      ? "border-primary ring-1 ring-primary/40 font-bold text-text bg-surface-raised"
                      : "border-border/60 hover:border-border"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  {p.name}
                  {!p.available && <Badge tone="muted">Bientôt</Badge>}
                </span>
                <span className={`w-4 h-4 rounded-full border ${p.color}`} />
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3 pt-6 border-t border-border/60">
          <label className="text-xs font-semibold text-text">Style de la grille du canvas</label>
          <Tabs
            variant="boxed"
            tabs={[
              { id: "dots", label: "Points (Dots)" },
              { id: "lines", label: "Lignes (Grid)" },
              { id: "cross", label: "Croix (Cross)" },
            ]}
            activeTab={state.gridStyle}
            onChange={state.setGridStyle}
          />
        </div>
      </div>
    );
  }

  if (tab === "editor") {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-bold text-text mb-1">Préférences de l'éditeur DBML</h2>
          <p className="text-xs text-text-muted">Ajustez le comportement du canvas et de la réorganisation visuelle.</p>
        </div>

        <div className="space-y-3">
          <label className="text-xs font-semibold text-text">Algorithme d'auto-layout</label>
          <Tabs
            variant="boxed"
            tabs={[
              { id: "dagre", label: "Dagre (Hiérarchique)" },
              { id: "force", label: "Force-Directed" },
            ]}
            activeTab={state.autoLayoutAlgo}
            onChange={state.setAutoLayoutAlgo}
          />
        </div>

        <div className="space-y-3 pt-6 border-t border-border/60">
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-surface-raised border border-border/60">
            <div>
              <div className="font-bold text-xs text-text">Aimantage des tables (grid snapping)</div>
              <div className="text-[11px] text-text-muted">Aligne automatiquement les tables sur la grille lors des déplacements.</div>
            </div>
            <input type="checkbox" defaultChecked className="w-4 h-4 accent-primary cursor-pointer" />
          </div>

          <div className="flex items-center justify-between p-3.5 rounded-xl bg-surface-raised border border-border/60">
            <div>
              <div className="font-bold text-xs text-text">Surlignage des clés étrangères</div>
              <div className="text-[11px] text-text-muted">Met en surbrillance les relations au survol des colonnes.</div>
            </div>
            <input type="checkbox" defaultChecked className="w-4 h-4 accent-primary cursor-pointer" />
          </div>
        </div>
      </div>
    );
  }

  if (tab === "team") {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-bold text-text mb-1">Équipe & collaborateurs</h2>
          <p className="text-xs text-text-muted">Gérez les permissions et l'accès à vos schémas depuis la liste de projets (icône équipe sur chaque carte).</p>
        </div>

        <Card variant="glass" className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs">
                {session.displayName.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="font-bold text-xs text-text">{session.displayName}</div>
                <div className="text-[11px] text-text-muted">{session.email}</div>
              </div>
            </div>
            <Badge tone={session.isAdmin ? "admin" : "success"}>
              {session.isAdmin ? "Administrateur" : "Propriétaire"}
            </Badge>
          </div>
        </Card>
      </div>
    );
  }

  if (tab === "billing") {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-bold text-text mb-1">Licence & monétisation</h2>
          <p className="text-xs text-text-muted">Détails de l'offre AthanorDB et statut de votre espace.</p>
        </div>

        <Card variant="glow" className="p-5 border-primary">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <SparklesIcon size={18} className="text-primary" />
              <span className="font-bold text-xs text-text">Offre : <b>Community Open-Core</b></span>
            </div>
            <Badge tone="success">Gratuit à vie (MIT)</Badge>
          </div>

          <p className="text-xs text-text-secondary leading-relaxed">
            Vous utilisez la version open source auto-hébergée : projets illimités, exports SQL, collaboration temps
            réel, sans licence ni abonnement. C'est aujourd'hui la seule façon d'exécuter AthanorDB — il n'existe pas
            d'offre hébergée, pas de facturation, et rien à activer.
          </p>
        </Card>

        <div className="space-y-2 pt-4 border-t border-border/60">
          <h3 className="text-xs font-bold text-text">Clés API</h3>
          <p className="text-xs text-text-muted leading-relaxed">
            Il n'y a pas encore d'API publique ni de clés d'API. L'application parle à son propre serveur via une
            session par cookie ; aucun jeton d'intégration n'est émis pour l'instant.
          </p>
        </div>
      </div>
    );
  }

  // about
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-text mb-1">À propos & système</h2>
        <p className="text-xs text-text-muted">Informations sur la version et le statut opérationnel.</p>
      </div>

      <div className="space-y-3 font-mono text-xs bg-surface p-4 rounded-xl border border-border/80">
        <div className="flex justify-between">
          <span className="text-text-muted">Version produit :</span>
          <span className="text-text font-bold">v0.0.1-open-core</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">Licence globale :</span>
          <span className="text-success font-bold">MIT Open Source</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">Statut serveur sync :</span>
          <span className="text-success font-bold flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse-subtle" /> Opérationnel
          </span>
        </div>
      </div>
    </div>
  );
}
