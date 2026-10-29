<script lang="ts">
  import Input from "@/components/ui/Input.svelte";
  import PageToolbar from "@/components/layout/PageToolbar.svelte";
  import PageIntro from "@/components/layout/PageIntro.svelte";
  import { untrack } from "svelte";
  import type { AdminConnectionSummary } from "@nebuladb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { CodeIcon, PencilIcon, PlusIcon, RestoreIcon, TrashIcon } from "@/components/icons/Icons";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import List from "@/components/ui/List.svelte";
  import ListRow from "@/components/ui/ListRow.svelte";
  import ConnectionEditor from "@/features/connections/form/ConnectionEditor.svelte";
  import PersonalAccountButton from "@/features/connections/personal/PersonalAccountButton.svelte";
  import DbConsole from "@/features/connections/console/DbConsole.svelte";
  import EnvironmentBadge from "@/features/environments/EnvironmentBadge.svelte";
  import { parseServerTime } from "@/features/sql/format";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatRelativeTime } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import {
    checkAdminConnectionHealth,
    deleteAdminConnection,
    fetchInstanceStructurePolicy,
    listAdminConnections,
    saveInstanceStructurePolicy,
  } from "@/services/dbAdminApi";
  import type { StructurePolicy, StructurePolicySetting } from "@nebuladb/shared";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import Select from "@/components/ui/Select.svelte";
  import { toast } from "@/components/ui/toast.svelte";

  /**
   * Database connections are instance-level: created, edited and deleted here
   * by an administrator, then attached to the projects that may deploy to
   * them. Opening one leads to the console — browse, query, manage accounts —
   * which works on the server itself and needs no project at all.
   *
   * Creating and editing take over the page (`ConnectionEditor`) rather than
   * opening a dialog, and a deletion is confirmed in the row it concerns: the
   * list is never covered by a backdrop.
   */
  let { initialConnectionId }: { initialConnectionId?: string } = $props();

  const { t } = useTranslation();
  const connections = useAsyncResource(listAdminConnections);
  let filter = $state("");
  let editing = $state.raw<AdminConnectionSummary | "new" | null>(null);
  let deleting = $state.raw<AdminConnectionSummary | null>(null);
  let consoleFor = $state.raw<AdminConnectionSummary | null>(null);
  let diff = $state.raw<{ projectId: string; connectionId: string } | null>(null);
  let checkingId = $state<string | null>(null);

  // One-shot: a jump from the global palette lands straight in that connection's console.
  let pendingConsoleId = $state(untrack(() => initialConnectionId));
  $effect(() => {
    if (!pendingConsoleId || !connections.data) return;
    consoleFor = connections.data.find((c) => c.id === pendingConsoleId) ?? null;
    pendingConsoleId = undefined;
  });

  const rows = $derived(
    (connections.data ?? []).filter((c) => {
      const needle = filter.trim().toLowerCase();
      if (!needle) return true;
      return [c.name, c.engine, c.environment ?? "", c.host ?? "", ...c.tags].some((v) =>
        v.toLowerCase().includes(needle),
      );
    }),
  );

  // The instance-wide default every connection follows unless it has its own.
  const defaultPolicy = useAsyncResource(fetchInstanceStructurePolicy);
  const savePolicy = useAsyncAction(async (next: StructurePolicySetting) => {
    await saveInstanceStructurePolicy(next);
    defaultPolicy.reload();
    toast.success(t("dbadmin.structure.defaultSaved"));
  });
  const policyOptions = $derived(
    (["schema-only", "warn", "free"] as StructurePolicy[]).map((value) => ({
      value,
      label: t(`dbadmin.structure.policy.${value}`),
      hint: t(`dbadmin.structure.policyHint.${value}`),
    })),
  );

  // A check says what it found twice: in the row (status, latency, version) and in a toast, so the click is never silent.
  const check = useAsyncAction(async (connection: AdminConnectionSummary) => {
    checkingId = connection.id;
    try {
      const { health } = await checkAdminConnectionHealth(connection.id);
      connections.reload();
      if (health.status === "online") {
        toast.success(t("admin.connections.checkedOnline", { name: connection.name, latency: health.latencyMs ?? 0 }));
      } else {
        toast.error(t("admin.connections.checkedOffline", { name: connection.name, error: health.error ?? "" }));
      }
    } finally {
      checkingId = null;
    }
  });

  const remove = useAsyncAction(async (connection: AdminConnectionSummary) => {
    await deleteAdminConnection(connection.id, connection.projects.length > 0);
    deleting = null;
    connections.reload();
  });

  function target(c: AdminConnectionSummary): string {
    if (c.engine === "sqlite") return c.filePath ?? "";
    if (c.engine === "bigquery") return [c.host, c.database].filter(Boolean).join(".");
    if (c.connectionString) return c.connectionString;
    return `${c.host ?? ""}${c.port ? `:${c.port}` : ""}${c.database ? `/${c.database}` : ""}`;
  }

  function healthLabel(c: AdminConnectionSummary): string {
    if (!c.health.status || !c.health.checkedAt) return t("admin.connections.health.unknown");
    const when = formatRelativeTime(parseServerTime(c.health.checkedAt), i18n.locale);
    return c.health.status === "online"
      ? t("admin.connections.health.online", {
          when,
          latency: c.health.latencyMs ?? 0,
          version: c.health.version ?? "",
        })
      : t("admin.connections.health.offline", { when, error: c.health.error ?? "" });
  }

  /** What follows the status word: latency and version when it answered, the error when it did not, then how long ago. */
  function healthDetail(c: AdminConnectionSummary): string {
    if (!c.health.status || !c.health.checkedAt) return "";
    const when = formatRelativeTime(parseServerTime(c.health.checkedAt), i18n.locale);
    const facts =
      c.health.status === "online"
        ? [c.health.latencyMs != null ? `${c.health.latencyMs} ms` : "", c.health.version ?? ""]
        : [c.health.error ?? ""];
    return [...facts, t("admin.connections.status.checked", { when })].filter(Boolean).join(" · ");
  }
</script>

{#if consoleFor}
  <DbConsole mode="monitoring" connection={consoleFor} onClose={() => (consoleFor = null)} />
{:else if editing}
  <ConnectionEditor
    connection={editing === "new" ? null : editing}
    onClose={() => (editing = null)}
    onSaved={() => {
      editing = null;
      connections.reload();
    }}
    onCheckDifferences={(projectId, connectionId) => (diff = { projectId, connectionId })}
  />
{:else}
  <div>
    <PageIntro>{t("admin.connections.hint")}</PageIntro>

    <PageToolbar>
      <Input inputSize="sm" class="w-64" bind:value={filter} placeholder={t("admin.connections.filter")} />
      <Button class="ml-auto" size="sm" variant="primary" onclick={() => (editing = "new")}>
        <Icon icon={PlusIcon} size={12} />
        {t("connections.newConnection")}
      </Button>
    </PageToolbar>

    {#if defaultPolicy.data}
      {@const current = defaultPolicy.data}
      <div
        class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border bg-surface px-3 py-2"
      >
        <span id="default-structure-policy" class="text-xs font-semibold text-text">
          {t("dbadmin.structure.defaultTitle")}
        </span>
        <Select
          size="sm"
          class="w-64"
          aria-labelledby="default-structure-policy"
          value={current.policy}
          options={policyOptions}
          disabled={savePolicy.pending}
          onChange={(policy) => void savePolicy.run({ ...current, policy })}
        />
        {#if current.policy !== "free"}
          <Checkbox
            checked={current.applyToSql}
            disabled={savePolicy.pending}
            onChange={(applyToSql) => void savePolicy.run({ ...current, applyToSql })}
          >
            <span class="text-xs">{t("dbadmin.structure.applyToSql")}</span>
          </Checkbox>
        {/if}
      </div>
    {/if}
    {#if savePolicy.error}<ErrorText>{savePolicy.error}</ErrorText>{/if}
    {#if connections.error ?? check.error}<ErrorText>{connections.error ?? check.error}</ErrorText>{/if}
    {#if rows.length === 0}
      <EmptyState>{connections.loading ? t("common.loading") : t("admin.connections.empty")}</EmptyState>
    {:else}
      <List>
        {#each rows as c (c.id)}
          {@const checking = checkingId === c.id}
          <ListRow>
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-body">
                <span class="font-semibold">{c.name}</span>
                <Badge tone="admin">{t(`connections.engine.${c.engine}`)}</Badge>
                {#if c.environment}<EnvironmentBadge
                    name={c.environment}
                    color={c.environmentColor}
                    production={c.production}
                  />{/if}
                {#if c.readOnly}<Badge tone="warning">{t("dbadmin.readOnly")}</Badge>{/if}
                {#each c.tags as tag (tag)}<Badge tone="muted">{tag}</Badge>{/each}
              </div>
              <span class="block truncate font-mono text-caption text-text-muted">{target(c)}</span>
              <div class="flex min-w-0 items-center gap-2 text-caption" aria-live="polite">
                {#if checking}
                  <span
                    class="size-2.5 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent motion-reduce:animate-none"
                    aria-hidden="true"
                  ></span>
                  <span class="font-medium text-text-secondary">{t("admin.connections.checking")}</span>
                {:else}
                  <span
                    class={`h-2 w-2 shrink-0 rounded-full ${
                      c.health.status === "online"
                        ? "bg-success"
                        : c.health.status === "offline"
                          ? "bg-danger"
                          : "bg-border-strong"
                    }`}
                    role="img"
                    aria-label={healthLabel(c)}
                  ></span>
                  <span
                    class={`font-semibold ${
                      c.health.status === "online"
                        ? "text-success"
                        : c.health.status === "offline"
                          ? "text-danger"
                          : "text-text-muted"
                    }`}
                  >
                    {c.health.status === "online"
                      ? t("admin.connections.status.online")
                      : c.health.status === "offline"
                        ? t("admin.connections.status.offline")
                        : t("admin.connections.status.unknown")}
                  </span>
                  {#if healthDetail(c)}
                    <span class="min-w-0 truncate text-text-muted" data-tooltip={healthDetail(c)}>
                      {healthDetail(c)}
                    </span>
                  {/if}
                {/if}
              </div>
            </div>
            <span
              class="shrink-0 text-xs text-text-muted"
              data-tooltip={c.projects.map((p) => p.name).join(", ") || undefined}
            >
              {t("admin.connections.projectCount", { count: c.projects.length })}
            </span>
            <PersonalAccountButton connection={c} />
            <Button variant="outline" size="sm" onclick={() => (consoleFor = c)}>
              <Icon icon={CodeIcon} size={13} />
              {t("admin.connections.open")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={checking}
              aria-label={t("admin.connections.checkHealth")}
              onclick={() => void check.run(c)}
            >
              {#if checking}
                <span
                  class="size-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
                  aria-hidden="true"
                ></span>
              {:else}
                <Icon icon={RestoreIcon} size={13} />
              {/if}
              {checking ? t("admin.connections.checking") : t("admin.connections.check")}
            </Button>
            <Button variant="ghost" size="icon" data-tooltip={t("common.edit")} onclick={() => (editing = c)}>
              <Icon icon={PencilIcon} size={13} />
            </Button>
            <Button variant="ghost" size="icon" data-tooltip={t("common.delete")} onclick={() => (deleting = c)}>
              <Icon icon={TrashIcon} size={13} />
            </Button>
          </ListRow>
          {#if deleting?.id === c.id}
            <div
              role="group"
              aria-label={t("admin.connections.deleteTitle", { name: c.name })}
              class="rounded-sm border border-danger/40 bg-danger-light px-3 py-2.5"
            >
              <p class="m-0 text-body font-semibold text-danger">{t("admin.connections.deleteTitle", { name: c.name })}</p>
              <Hint>{t("admin.connections.deleteHint")}</Hint>
              {#if c.projects.length > 0}
                <p class="mb-3 mt-0 text-body-sm text-warning">
                  {t("admin.connections.deleteInUse", { projects: c.projects.map((p) => p.name).join(", ") })}
                </p>
              {/if}
              <div class="flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onclick={() => (deleting = null)} disabled={remove.pending}
                  >{t("common.cancel")}</Button
                >
                <Button variant="danger" size="sm" onclick={() => void remove.run(c)} disabled={remove.pending}>
                  {remove.pending ? t("common.deleting") : t("common.delete")}
                </Button>
              </div>
              {#if remove.error}<ErrorText>{remove.error}</ErrorText>{/if}
            </div>
          {/if}
        {/each}
      </List>
    {/if}
  </div>
{/if}

{#if diff}
  {#await import("@/features/connections/deployment/DatabaseDifferencesDialog.svelte") then { default: DatabaseDifferencesDialog }}
    <DatabaseDifferencesDialog
      projectId={diff.projectId}
      initialConnectionId={diff.connectionId}
      onClose={() => (diff = null)}
    />
  {/await}
{/if}
