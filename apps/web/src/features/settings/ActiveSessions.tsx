import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ErrorText } from "@/components/ui/Alert";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { formatRelativeTime } from "@/i18n/formatters";
import { useTranslation } from "@/i18n/useTranslation";
import { fetchActiveSessions, revokeOtherSessions, revokeSession } from "@/services/authApi";

/**
 * The user's own logged-in sessions, with per-session and bulk revocation.
 *
 * Before this existed there was no way to end a session other than waiting out
 * its 30-day rolling expiry — a laptop left at a client site or a session on a
 * shared machine could only be dealt with by asking an admin to reset the
 * password, which is a blunt instrument for "I forgot to log out".
 */

const BROWSER_PATTERN = /Firefox\/|Edg\/|OPR\/|Chrome\/|Safari\//;
const OS_PATTERN = /Windows|Macintosh|Mac OS|Linux|Android|iPhone|iPad/;
const BROWSER_ALIASES: Record<string, string> = { Edg: "Edge", OPR: "Opera" };
const MAX_RAW_USER_AGENT_LENGTH = 60;

/** Turns a user-agent string into something a person can recognise their own device by. */
function describeDevice(userAgent: string | null, unknownLabel: string): string {
  if (!userAgent) return unknownLabel;
  const rawBrowser = BROWSER_PATTERN.exec(userAgent)?.[0]?.replace(/\/$/, "");
  const browser = rawBrowser ? (BROWSER_ALIASES[rawBrowser] ?? rawBrowser) : undefined;
  const operatingSystem = OS_PATTERN.exec(userAgent)?.[0];
  const parts = [browser, operatingSystem].filter(Boolean);
  // Falls back to the raw string rather than "unknown": a non-browser client
  // (a script, a curl session) is exactly the thing worth noticing here.
  return parts.length > 0 ? parts.join(" — ") : userAgent.slice(0, MAX_RAW_USER_AGENT_LENGTH);
}

export function ActiveSessions() {
  const { t, locale } = useTranslation();
  const sessions = useAsyncResource(fetchActiveSessions);

  const revokeOne = useAsyncAction(async (sessionId: string, isCurrent: boolean) => {
    await revokeSession(sessionId);
    // Revoking the current session is a logout — the cookie is already
    // cleared server-side, so reload rather than leave a dead UI behind.
    if (isCurrent) {
      window.location.reload();
      return;
    }
    sessions.reload();
  });

  const revokeAllOthers = useAsyncAction(async () => {
    await revokeOtherSessions();
    sessions.reload();
  });

  const rows = sessions.data ?? [];
  const otherSessionCount = rows.filter((session) => !session.current).length;
  const pending = revokeOne.pending || revokeAllOthers.pending;
  const error = sessions.error ?? revokeOne.error ?? revokeAllOthers.error;

  return (
    <div className="pt-6 border-t border-border/60">
      <h3 className="text-sm font-bold text-text mb-1">{t("settings.sessions.title")}</h3>
      <p className="text-xs text-text-muted mb-4">{t("settings.sessions.description")}</p>

      {error && <ErrorText>{error}</ErrorText>}

      <ul className="space-y-2 max-w-2xl">
        {rows.map((session) => (
          <li
            key={session.id}
            className="flex items-center gap-3 rounded-lg border border-border/70 bg-surface/60 px-3 py-2 text-xs"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-text truncate">
                  {describeDevice(session.userAgent, t("settings.sessions.unknownDevice"))}
                </span>
                {session.current && <Badge tone="success">{t("settings.sessions.thisDevice")}</Badge>}
              </div>
              <div className="text-text-muted mt-0.5">
                {t("settings.sessions.meta", {
                  ip: session.ip ?? t("settings.sessions.unknownIp"),
                  lastSeen: formatRelativeTime(session.lastSeenAt, locale),
                })}
              </div>
            </div>
            <Button
              variant="danger-ghost"
              size="sm"
              disabled={pending}
              onClick={() => void revokeOne.run(session.id, session.current)}
            >
              {session.current ? t("common.logout") : t("settings.sessions.revoke")}
            </Button>
          </li>
        ))}
      </ul>

      {otherSessionCount > 0 && (
        <Button
          variant="outline"
          className="mt-3 text-xs"
          disabled={pending}
          onClick={() => void revokeAllOthers.run()}
        >
          {t("settings.sessions.revokeOthers", { count: otherSessionCount })}
        </Button>
      )}
    </div>
  );
}
