import { useEffect, useState } from "react";
import { ErrorText, Hint } from "../ui/Alert.js";
import { EmptyState } from "../ui/List.js";
import { SELECT_SM_CLASS } from "../ui/inputStyles.js";
import type { AuditEntry } from "../types.js";

/**
 * Read-only view of the audit trail. There is intentionally no way to edit or
 * delete entries from here — a console that let an administrator rewrite the
 * record of what administrators did would be worse than having no record.
 */
const ACTION_FILTERS = [
  { value: "", label: "Toutes les actions" },
  { value: "project.delete", label: "Suppression de projet" },
  { value: "project.export", label: "Export de schéma" },
  { value: "project.team.grant", label: "Permission accordée" },
  { value: "project.team.revoke", label: "Permission retirée" },
  { value: "user.disable", label: "Compte désactivé" },
  { value: "user.delete", label: "Compte supprimé" },
  { value: "user.password.reset", label: "Mot de passe réinitialisé" },
  { value: "auth.login.locked", label: "Connexion bloquée" },
];

/** Actions worth spotting at a glance in a long list. */
const SEVERE = new Set(["project.delete", "user.delete", "user.disable", "auth.login.locked"]);

export function AuditTab() {
  const [action, setAction] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The loaded rows are tagged with the filter that produced them, so
  // "loading" is derived from the two disagreeing rather than being a third
  // state flipped from inside the effect (which is both a cascading render and
  // a lint error in this repo's config).
  const [loaded, setLoaded] = useState<{ action: string; rows: AuditEntry[] } | null>(null);
  const loading = loaded?.action !== action;
  const entries = loaded?.action === action ? loaded.rows : [];

  useEffect(() => {
    let cancelled = false;
    const query = action ? `?action=${encodeURIComponent(action)}` : "";
    fetch(`/api/audit${query}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`load failed (${r.status})`))))
      .then((rows: AuditEntry[]) => {
        if (cancelled) return;
        setLoaded({ action, rows });
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message);
        // Settle the derived loading state — otherwise a failed request leaves
        // the view stuck on "Chargement…" with an error underneath it.
        setLoaded({ action, rows: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [action]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <select className={SELECT_SM_CLASS} value={action} onChange={(e) => setAction(e.target.value)}>
          {ACTION_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-text-muted">{loading ? "Chargement…" : `${entries.length} entrée(s)`}</span>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {!loading && entries.length === 0 ? (
        <EmptyState>Aucune action enregistrée pour ce filtre.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-left text-[12.5px]">
            <thead className="bg-surface-raised/60 text-[11px] uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">Auteur</th>
                <th className="px-3 py-2 font-semibold">Action</th>
                <th className="px-3 py-2 font-semibold">Cible</th>
                <th className="px-3 py-2 font-semibold">Détail</th>
                <th className="px-3 py-2 font-semibold">IP</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t border-border/60">
                  <td className="whitespace-nowrap px-3 py-2 text-text-muted">{entry.createdAt}</td>
                  <td className="px-3 py-2">{entry.actorEmail ?? <span className="text-text-muted">—</span>}</td>
                  <td className={`px-3 py-2 font-mono text-[11.5px] ${SEVERE.has(entry.action) ? "text-danger" : ""}`}>
                    {entry.action}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-text-muted">
                    {entry.targetType ? `${entry.targetType}/${entry.targetId?.slice(0, 8)}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{entry.detail ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-text-muted">{entry.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Hint>
        Seules les actions sensibles sont enregistrées (suppressions, changements de permission, exports, gestion des
        comptes). Les modifications de schéma ne le sont pas : elles figurent déjà dans l'historique de chaque projet,
        avec leur auteur.
      </Hint>
    </div>
  );
}
