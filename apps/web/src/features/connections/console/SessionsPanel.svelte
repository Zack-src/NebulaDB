<script lang="ts">
  import Table, { TABLE_ROW } from "@/components/ui/Table.svelte";
  import type { DbAdminSession } from "@nebuladb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { CloseIcon, RestoreIcon } from "@/components/icons/Icons";
  import Button from "@/components/ui/Button.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { fetchSessions, killSession, type ConnectionOverview } from "@/services/dbAdminApi";
  import StatementModal from "./StatementModal.svelte";

  /** Who is connected to the server right now and what they are running, with a way to end a stuck session. */
  let { connectionId, overview }: { connectionId: string; overview: ConnectionOverview } = $props();

  const { t } = useTranslation();
  const sessions = useAsyncResource(() => fetchSessions(connectionId));
  let killTarget = $state.raw<DbAdminSession | null>(null);

  function duration(seconds: number | null): string {
    if (seconds === null) return "";
    if (seconds < 60) return `${seconds} s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
    return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`;
  }

  const tableColumns = $derived([
    { label: "ID" },
    { label: t("dbadmin.sessions.user") },
    { label: t("dbadmin.database") },
    { label: t("dbadmin.sessions.client") },
    { label: t("dbadmin.sessions.state") },
    { label: t("dbadmin.sessions.duration") },
    { label: t("dbadmin.sessions.query") },
    { label: "" },
  ]);
</script>

<div>
  <div class="mb-2 flex items-center justify-between">
    <span class="text-xs text-text-muted">{t("dbadmin.sessions.hint")}</span>
    <Button variant="ghost" size="xs" onclick={() => sessions.reload()} disabled={sessions.loading}>
      <Icon icon={RestoreIcon} size={12} />
      {t("dbadmin.refresh")}
    </Button>
  </div>
  {#if sessions.error}<ErrorText>{sessions.error}</ErrorText>{/if}
  {#if (sessions.data ?? []).length === 0}
    <EmptyState>{sessions.loading ? t("common.loading") : t("dbadmin.sessions.empty")}</EmptyState>
  {:else}
    <Table label={t("dbadmin.sessions.hint")} columns={tableColumns} density="compact">
          {#each sessions.data ?? [] as session (session.id)}
            <tr class={`${TABLE_ROW} align-top`}>
              <td class="px-2 py-1 font-mono">{session.id}</td>
              <td class="px-2 py-1">{session.user ?? ""}</td>
              <td class="px-2 py-1">{session.database ?? ""}</td>
              <td class="px-2 py-1">{session.client ?? ""}</td>
              <td class="px-2 py-1">{session.state ?? ""}</td>
              <td class="px-2 py-1 whitespace-nowrap">{duration(session.durationSeconds)}</td>
              <td class="max-w-[280px] truncate px-2 py-1 font-mono" title={session.query ?? ""}>{session.query ?? ""}</td>
              <td class="px-1 py-0.5">
                <Button
                  variant="danger-ghost"
                  size="icon-xs"
                  disabled={overview.readOnly}
                  data-tooltip={overview.readOnly ? t("dbadmin.readOnlyConnection") : t("dbadmin.sessions.kill")}
                  onclick={() => (killTarget = session)}
                >
                  <Icon icon={CloseIcon} size={12} />
                </Button>
              </td>
            </tr>
          {/each}
        </Table>
  {/if}
</div>

{#if killTarget}
  {@const target = killTarget}
  <StatementModal
    title={t("dbadmin.sessions.killTitle", { id: target.id })}
    hint={t("dbadmin.sessions.killHint")}
    danger
    run={(execute) => killSession(connectionId, target.id, execute)}
    onClose={() => (killTarget = null)}
    onDone={() => {
      killTarget = null;
      sessions.reload();
    }}
  />
{/if}
