<script lang="ts">
  import type { AdminConnectionSummary } from "@nebuladb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { CodeIcon, PencilIcon, PlusIcon, RestoreIcon, TrashIcon } from "@/components/icons/Icons";
  import Modal from "@/components/overlays/Modal.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { INPUT_SM_CLASS } from "@/components/ui/inputStyles";
  import List from "@/components/ui/List.svelte";
  import ListMain from "@/components/ui/ListMain.svelte";
  import ListRow from "@/components/ui/ListRow.svelte";
  import ConnectionEditModal from "@/features/admin/connections/ConnectionEditModal.svelte";
  import PersonalAccountButton from "@/features/connections/PersonalAccountButton.svelte";
  import DbConsole from "@/features/admin/connections/DbConsole.svelte";
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
   */
  const { t } = useTranslation();
  const connections = useAsyncResource(listAdminConnections);
  let filter = $state("");
  let editing = $state.raw<AdminConnectionSummary | "new" | null>(null);
  let deleting = $state.raw<AdminConnectionSummary | null>(null);
  let consoleFor = $state.raw<AdminConnectionSummary | null>(null);
  let diff = $state.raw<{ projectId: string; connectionId: string } | null>(null);
  let checkingId = $state<string | null>(null);

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

  const check = useAsyncAction(async (id: string) => {
    checkingId = id;
    try {
      await checkAdminConnectionHealth(id);
      connections.reload();
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
</script>

{#if consoleFor}
  <DbConsole mode="monitoring" connection={consoleFor} onClose={() => (consoleFor = null)} />
{:else}
  <div>
    <p class="mb-4 max-w-[640px] text-xs text-text-muted">{t("admin.connections.hint")}</p>

    <div class="mb-3 flex items-center gap-2">
      <input class={`${INPUT_SM_CLASS} w-64`} bind:value={filter} placeholder={t("admin.connections.filter")} />
      <Button class="ml-auto" size="sm" variant="primary" onclick={() => (editing = "new")}>
        <Icon icon={PlusIcon} size={12} />
        {t("connections.newConnection")}
      </Button>
    </div>

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
          <ListRow>
            <span
              class={`h-2 w-2 shrink-0 rounded-full ${
                c.health.status === "online"
                  ? "bg-success"
                  : c.health.status === "offline"
                    ? "bg-danger"
                    : "bg-border-strong"
              }`}
              data-tooltip={healthLabel(c)}
              role="img"
              aria-label={healthLabel(c)}
            ></span>
            <ListMain>
              <span class="font-semibold">{c.name}</span>
              <Badge tone="admin">{t(`connections.engine.${c.engine}`)}</Badge>
              {#if c.environment}<EnvironmentBadge
                  name={c.environment}
                  color={c.environmentColor}
                  production={c.production}
                />{/if}
              {#if c.readOnly}<Badge tone="warning">{t("dbadmin.readOnly")}</Badge>{/if}
              {#each c.tags as tag (tag)}<Badge tone="muted">{tag}</Badge>{/each}
              <span class="block truncate font-mono text-[11px] text-text-muted">{target(c)}</span>
            </ListMain>
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
              variant="ghost"
              size="icon"
              disabled={checkingId === c.id}
              data-tooltip={t("admin.connections.checkHealth")}
              onclick={() => void check.run(c.id)}
            >
              <Icon icon={RestoreIcon} size={13} />
            </Button>
            <Button variant="ghost" size="icon" data-tooltip={t("common.edit")} onclick={() => (editing = c)}>
              <Icon icon={PencilIcon} size={13} />
            </Button>
            <Button variant="ghost" size="icon" data-tooltip={t("common.delete")} onclick={() => (deleting = c)}>
              <Icon icon={TrashIcon} size={13} />
            </Button>
          </ListRow>
        {/each}
      </List>
    {/if}
  </div>
{/if}

{#if editing}
  <ConnectionEditModal
    connection={editing === "new" ? null : editing}
    onClose={() => (editing = null)}
    onSaved={() => {
      editing = null;
      connections.reload();
    }}
    onCheckDifferences={(projectId, connectionId) => {
      editing = null;
      diff = { projectId, connectionId };
    }}
  />
{/if}

{#if diff}
  {#await import("@/features/connections/DatabaseDifferencesDialog.svelte") then { default: DatabaseDifferencesDialog }}
    <DatabaseDifferencesDialog
      projectId={diff.projectId}
      initialConnectionId={diff.connectionId}
      onClose={() => (diff = null)}
    />
  {/await}
{/if}

{#if deleting}
  {@const connection = deleting}
  <Modal
    title={t("admin.connections.deleteTitle", { name: connection.name })}
    onClose={() => (deleting = null)}
    dismissable={!remove.pending}
  >
    <Hint>{t("admin.connections.deleteHint")}</Hint>
    {#if connection.projects.length > 0}
      <p class="mb-3 text-[12.5px] text-warning">
        {t("admin.connections.deleteInUse", { projects: connection.projects.map((p) => p.name).join(", ") })}
      </p>
    {/if}
    <div class="flex items-center justify-end gap-2">
      <Button variant="ghost" size="sm" onclick={() => (deleting = null)} disabled={remove.pending}
        >{t("common.cancel")}</Button
      >
      <Button variant="danger" size="sm" onclick={() => void remove.run(connection)} disabled={remove.pending}>
        {remove.pending ? t("common.deleting") : t("common.delete")}
      </Button>
    </div>
    {#if remove.error}<ErrorText>{remove.error}</ErrorText>{/if}
  </Modal>
{/if}
