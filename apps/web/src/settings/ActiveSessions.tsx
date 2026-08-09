import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui/Button.js";
import { Badge } from "../ui/Badge.js";
import { ErrorText } from "../ui/Alert.js";
import type { SessionSummary } from "../types.js";

/**
 * The user's own logged-in sessions, with per-session and bulk revocation.
 *
 * Before this existed there was no way to end a session other than waiting out
 * its 30-day rolling expiry — a laptop left at a client site or a session on a
 * shared machine could only be dealt with by asking an admin to reset the
 * password, which is a blunt instrument for "I forgot to log out".
 */

/** Turns a user-agent string into something a person can recognise their own device by. */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Appareil inconnu";
  const browser = /Firefox\/|Edg\/|OPR\/|Chrome\/|Safari\//.exec(userAgent)?.[0]?.replace(/\/$/, "");
  const os = /Windows|Macintosh|Mac OS|Linux|Android|iPhone|iPad/.exec(userAgent)?.[0];
  const named = [browser === "Edg" ? "Edge" : browser === "OPR" ? "Opera" : browser, os].filter(Boolean);
  // Falls back to the raw string rather than "unknown": a non-browser client
  // (a script, a curl session) is exactly the thing worth noticing here.
  return named.length > 0 ? named.join(" — ") : userAgent.slice(0, 60);
}

export function ActiveSessions() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    fetch("/api/auth/sessions")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`chargement impossible (${r.status})`))))
      .then((rows: SessionSummary[]) => {
        setSessions(rows);
        setError(null);
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(refresh, [refresh]);

  async function revoke(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/sessions/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`révocation impossible (${res.status})`);
      // Revoking the current session is a logout — the cookie is already
      // cleared server-side, so reload rather than leave a dead UI behind.
      if (sessions.find((s) => s.id === id)?.current) {
        window.location.reload();
        return;
      }
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revokeOthers() {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/sessions/revoke-others", { method: "POST" });
      if (!res.ok) throw new Error(`révocation impossible (${res.status})`);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const others = sessions.filter((s) => !s.current).length;

  return (
    <div className="pt-6 border-t border-border/60">
      <h3 className="text-sm font-bold text-text mb-1">Sessions actives</h3>
      <p className="text-xs text-text-muted mb-4">
        Les appareils actuellement connectés à ce compte. Révoquez une session si vous ne la reconnaissez pas ou si
        l'appareil ne vous appartient plus.
      </p>

      {error && <ErrorText>{error}</ErrorText>}

      <ul className="space-y-2 max-w-2xl">
        {sessions.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-3 rounded-lg border border-border/70 bg-surface/60 px-3 py-2 text-xs"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-text truncate">{describeDevice(s.userAgent)}</span>
                {s.current && <Badge tone="success">Cet appareil</Badge>}
              </div>
              <div className="text-text-muted mt-0.5">
                {s.ip ?? "IP inconnue"} · dernière activité {s.lastSeenAt}
              </div>
            </div>
            <Button variant="danger-ghost" size="sm" disabled={busy} onClick={() => void revoke(s.id)}>
              {s.current ? "Se déconnecter" : "Révoquer"}
            </Button>
          </li>
        ))}
      </ul>

      {others > 0 && (
        <Button variant="outline" className="mt-3 text-xs" disabled={busy} onClick={() => void revokeOthers()}>
          Déconnecter les {others} autre(s) session(s)
        </Button>
      )}
    </div>
  );
}
