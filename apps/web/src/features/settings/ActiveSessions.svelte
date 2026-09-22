<script lang="ts" module>
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
</script>

<script lang="ts">
  import Button from "@/components/ui/Button.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatRelativeTime } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { fetchActiveSessions, revokeOtherSessions, revokeSession } from "@/services/authApi";

  const { t } = useTranslation();
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

  const rows = $derived(sessions.data ?? []);
  const otherSessionCount = $derived(rows.filter((session) => !session.current).length);
  const pending = $derived(revokeOne.pending || revokeAllOthers.pending);
  const error = $derived(sessions.error ?? revokeOne.error ?? revokeAllOthers.error);
</script>

<div class="pt-6 border-t border-border/60">
  <h3 class="text-sm font-bold text-text mb-1">{t("settings.sessions.title")}</h3>
  <p class="text-xs text-text-muted mb-4">{t("settings.sessions.description")}</p>

  {#if error}<ErrorText>{error}</ErrorText>{/if}

  <ul class="space-y-2 max-w-2xl">
    {#each rows as session (session.id)}
      <li class="flex items-center gap-3 rounded-lg border border-border/70 bg-surface/60 px-3 py-2 text-xs">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="font-semibold text-text truncate">
              {describeDevice(session.userAgent, t("settings.sessions.unknownDevice"))}
            </span>
            {#if session.current}<Badge tone="success">{t("settings.sessions.thisDevice")}</Badge>{/if}
          </div>
          <div class="text-text-muted mt-0.5">
            {t("settings.sessions.meta", {
              ip: session.ip ?? t("settings.sessions.unknownIp"),
              lastSeen: formatRelativeTime(session.lastSeenAt, i18n.locale),
            })}
          </div>
        </div>
        <Button
          variant="danger-ghost"
          size="sm"
          disabled={pending}
          onclick={() => void revokeOne.run(session.id, session.current)}
        >
          {session.current ? t("common.logout") : t("settings.sessions.revoke")}
        </Button>
      </li>
    {/each}
  </ul>

  {#if otherSessionCount > 0}
    <Button variant="outline" class="mt-3 text-xs" disabled={pending} onclick={() => void revokeAllOthers.run()}>
      {t("settings.sessions.revokeOthers", { count: otherSessionCount })}
    </Button>
  {/if}
</div>
