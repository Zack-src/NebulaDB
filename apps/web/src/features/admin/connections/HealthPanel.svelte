<script lang="ts">
  import Icon from "@/components/icons/Icon.svelte";
  import { RestoreIcon } from "@/components/icons/Icons";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { parseServerTime } from "@/features/sql/format";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatDateTime } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { fetchHealthBoard } from "@/services/connectionJournalApi";

  /**
   * A database's health at a glance: a fresh probe (latency, version), the
   * latency of the last probes, sizes, sessions and the sessions waiting on a
   * lock. A part the engine or the account cannot give is said so, never
   * shown as zero.
   */
  let { connectionId }: { connectionId: string } = $props();

  const { t } = useTranslation();
  const board = useAsyncResource(() => fetchHealthBoard(connectionId));

  function size(bytes: number | null): string {
    if (bytes === null) return "—";
    const units = ["o", "Ko", "Mo", "Go", "To"];
    let n = bytes;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n.toLocaleString(i18n.locale, { maximumFractionDigits: 1 })} ${units[i]}`;
  }

  /** The latency series as a polyline in a 200 x 40 box; a failed probe sits on the floor. */
  const line = $derived.by(() => {
    const points = board.data?.history ?? [];
    if (points.length < 2) return "";
    const max = Math.max(1, ...points.map((p) => p.latencyMs));
    return points
      .map((p, i) => `${((i / (points.length - 1)) * 200).toFixed(1)},${(38 - (p.ok ? (p.latencyMs / max) * 34 : 0)).toFixed(1)}`)
      .join(" ");
  });
</script>

<div data-testid="health-board">
  <div class="mb-3 flex items-center justify-between">
    <span class="text-xs text-text-muted">{t("health.hint")}</span>
    <Button variant="ghost" size="xs" onclick={() => board.reload()} disabled={board.loading}>
      <Icon icon={RestoreIcon} size={12} />
      {t("dbadmin.refresh")}
    </Button>
  </div>
  {#if board.error}<ErrorText>{board.error}</ErrorText>{/if}
  {#if !board.data}
    <EmptyState>{t("common.loading")}</EmptyState>
  {:else}
    {@const data = board.data}
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div class="rounded-lg border border-border p-3" data-testid="health-status" data-ok={data.status.ok}>
        <div class="text-[11px] text-text-muted">{t("health.status")}</div>
        <div class="mt-1"><Badge tone={data.status.ok ? "success" : "danger"}>{data.status.ok ? t("health.online") : t("health.offline")}</Badge></div>
        {#if data.status.error}<div class="mt-1 break-words text-[11px] text-danger">{data.status.error}</div>{/if}
      </div>
      <div class="rounded-lg border border-border p-3">
        <div class="text-[11px] text-text-muted">{t("health.latency")}</div>
        <div class="mt-1 text-[15px] font-semibold tabular-nums">{data.status.latencyMs ?? "—"} ms</div>
        {#if line}
          <svg viewBox="0 0 200 40" class="mt-1 h-10 w-full text-primary" role="img" aria-label={t("health.latencySeries")}>
            <polyline points={line} fill="none" stroke="currentColor" stroke-width="1.5" />
          </svg>
        {/if}
      </div>
      <div class="rounded-lg border border-border p-3">
        <div class="text-[11px] text-text-muted">{t("health.version")}</div>
        <div class="mt-1 break-words text-[12px]">{data.status.version ?? "—"}</div>
        {#if data.status.checkedAt}
          <div class="mt-1 text-[11px] text-text-muted">{formatDateTime(parseServerTime(data.status.checkedAt), i18n.locale)}</div>
        {/if}
      </div>
      <div class="rounded-lg border border-border p-3" data-testid="health-sessions">
        <div class="text-[11px] text-text-muted">{t("health.sessions")}</div>
        {#if data.sessions}
          <div class="mt-1 text-[15px] font-semibold tabular-nums">{data.sessions.total}</div>
          <div class="text-[11px] text-text-muted">
            {t("health.sessionsSplit", { active: data.sessions.active, idle: data.sessions.idle })}
          </div>
          {#if data.sessions.longestSeconds !== null}
            <div class="text-[11px] text-text-muted">
              {t("health.longest", { seconds: data.sessions.longestSeconds, user: data.sessions.longestUser ?? "—" })}
            </div>
          {/if}
        {:else}
          <div class="mt-1 text-[12px] text-text-muted">{t("health.unavailable")}</div>
        {/if}
      </div>
    </div>

    <h4 class="mt-4 mb-2 text-xs font-bold text-text">{t("health.blocking")}</h4>
    {#if data.blocking === null}
      <div class="text-[12px] text-text-muted">{t("health.unavailable")}</div>
    {:else if data.blocking.length === 0}
      <div class="text-[12px] text-text-muted" data-testid="health-no-blocking">{t("health.noBlocking")}</div>
    {:else}
      <ul class="m-0 list-none rounded-lg border border-warning/60 p-0" data-testid="health-blocking">
        {#each data.blocking as pair (pair.blocked + ">" + pair.blocker)}
          <li class="px-3 py-1.5 font-mono text-[12px]">
            {t("health.blockedBy", { blocked: pair.blocked, blocker: pair.blocker })}
          </li>
        {/each}
      </ul>
      <Hint>{t("health.blockingHint")}</Hint>
    {/if}

    <h4 class="mt-4 mb-2 text-xs font-bold text-text">{t("health.databases")}</h4>
    {#if data.databases === null}
      <div class="text-[12px] text-text-muted">{t("health.unavailable")}</div>
    {:else}
      <div class="overflow-x-auto rounded-lg border border-border">
        <table class="w-full border-collapse text-[12px]" aria-label={t("health.databases")}>
          <tbody class="divide-y divide-border/60">
            {#each data.databases.filter((d) => !d.system) as database (database.name)}
              <tr>
                <td class="px-3 py-1.5">{database.name}</td>
                <td class="px-3 py-1.5 text-right tabular-nums">{size(database.sizeBytes)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>
