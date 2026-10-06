<script lang="ts">
  import type { AdminConnectionSummary, ConnectionAuthMode, DatabaseEngine, StructurePolicy } from "@nebuladb/shared";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import RadioGroup from "@/components/ui/RadioGroup.svelte";
  import ConfirmDialog from "@/components/overlays/ConfirmDialog.svelte";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { CheckCircleIcon, CheckIcon } from "@/components/icons/Icons";
  import { INPUT_CLASS, INPUT_SM_CLASS } from "@/components/ui/inputStyles";
  import ConnectionFormFields, { DEFAULT_PORTS } from "@/features/connections/ConnectionFormFields.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { describeApiError } from "@/i18n/serverErrorMessages";
  import { pullDatabaseSchema } from "@/services/connectionsApi";
  import {
    createAdminConnection,
    fetchCredentialHolders,
    setAdminConnectionProjects,
    testAdminConnection,
    updateAdminConnection,
    type AdminConnectionInput,
  } from "@/services/dbAdminApi";
  import { fetchProjects } from "@/services/projectsApi";

  /**
   * Create or edit one instance-level connection, and choose which projects
   * may use it. A project it is attached to can deploy to it, pull its schema
   * and diff against it — the two per-project actions offered at the bottom —
   * but only an instance administrator ever sees or changes its settings.
   */
  let {
    connection,
    onClose,
    onSaved,
    onCheckDifferences,
  }: {
    connection: AdminConnectionSummary | null;
    onClose: () => void;
    onSaved: () => void;
    onCheckDifferences: (projectId: string, connectionId: string) => void;
  } = $props();

  const { t } = useTranslation();
  const LABEL = "mb-1 block text-xs font-medium text-text-muted";

  // The form is a one-time copy of the connection being edited: the modal is
  // recreated for each edit, so there is nothing to keep in sync afterwards.
  // svelte-ignore state_referenced_locally
  const initial = connection;
  let name = $state(initial?.name ?? "");
  let environmentId = $state(initial?.environmentId ?? "");
  let engine = $state<DatabaseEngine>(initial?.engine ?? "postgres");
  let host = $state(initial?.host ?? "localhost");
  let port = $state(initial?.port ?? DEFAULT_PORTS[initial?.engine ?? "postgres"]);
  let database = $state(initial?.database ?? "");
  let user = $state(initial?.user ?? "");
  let password = $state("");
  let ssl = $state(Boolean(initial?.ssl));
  let connectionString = $state(initial?.connectionString ?? "");
  let filePath = $state(initial?.filePath ?? "");
  let useUri = $state(Boolean(initial?.connectionString));
  let tags = $state((initial?.tags ?? []).join(", "));
  let readOnly = $state(Boolean(initial?.readOnly));
  let authMode = $state<ConnectionAuthMode>(initial?.authMode ?? "personal");
  /** A personal account replaces a user and a password: there are none in a SQLite file or a connection string. */
  const personalPossible = $derived(engine !== "sqlite" && !useUri);
  // Who has already given an account: what tells an administrator the switch will not lock everyone out.
  const holders = useAsyncResource(() => (initial ? fetchCredentialHolders(initial.id) : Promise.resolve([])));
  // "inherit" is this form's word for "no policy of its own" (`null` on the wire).
  let structurePolicy = $state<StructurePolicy | "inherit">(initial?.structurePolicy?.policy ?? "inherit");
  let structureApplyToSql = $state(initial?.structurePolicy?.applyToSql ?? true);
  let projectIds = $state<string[]>((initial?.projects ?? []).map((p) => p.id));
  // The database each attached project uses on this server; empty: the connection's own.
  let projectDatabases = $state<Record<string, string>>(
    Object.fromEntries((initial?.projects ?? []).map((p) => [p.id, p.database ?? ""])),
  );
  let createDatabases = $state(true);
  /** A project can only be given a database where the connection has one to replace. */
  const namesDatabase = $derived(engine !== "sqlite" && !useUri);
  const links = $derived(
    projectIds.map((projectId) => ({
      projectId,
      database: (namesDatabase && projectDatabases[projectId]?.trim()) || null,
    })),
  );
  const linkKey = (list: { projectId: string; database: string | null }[]) =>
    list
      .map((link) => `${link.projectId}=${link.database ?? ""}`)
      .sort()
      .join();

  const projects = useAsyncResource(fetchProjects);
  const activeProjects = $derived((projects.data ?? []).filter((p) => p.status === "active"));
  const linkedIds = $derived(new Set((initial?.projects ?? []).map((p) => p.id)));

  function payload(): AdminConnectionInput {
    const network = !useUri && engine !== "sqlite";
    return {
      name: name.trim(),
      environmentId: environmentId || null,
      engine,
      host: network ? host : undefined,
      port: network ? Number(port) : undefined,
      database: network ? database : undefined,
      user: network && authMode === "shared" ? user : undefined,
      password: network && authMode === "shared" ? password || undefined : undefined,
      ssl: network ? ssl : undefined,
      // Empty rather than left out: an update that does not mention it would keep the stored one.
      connectionString: useUri && engine !== "sqlite" ? connectionString : "",
      filePath: engine === "sqlite" ? filePath : undefined,
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      readOnly,
      authMode: personalPossible ? authMode : "shared",
      structurePolicy:
        structurePolicy === "inherit" ? null : { policy: structurePolicy, applyToSql: structureApplyToSql },
    };
  }

  let testResult = $state.raw<{ ok: boolean; message: string } | null>(null);
  const test = useAsyncAction(async () => {
    testResult = null;
    try {
      const res = await testAdminConnection(payload(), initial?.id);
      testResult = res.ok
        ? {
            ok: true,
            message: `${t("connections.testSuccess")}: ${res.version ?? ""} ${res.database ? `(${res.database})` : ""}`,
          }
        : { ok: false, message: res.error || t("connections.testFailed") };
    } catch (err) {
      testResult = { ok: false, message: describeApiError(err, t) };
    }
  });

  const save = useAsyncAction(async () => {
    const saved = initial ? await updateAdminConnection(initial.id, payload()) : await createAdminConnection(payload());
    const before = linkKey((initial?.projects ?? []).map((p) => ({ projectId: p.id, database: p.database ?? null })));
    if (linkKey(links) !== before) await setAdminConnectionProjects(saved.id, links, createDatabases);
    onSaved();
  });

  let pullMessage = $state<string | null>(null);
  /** The project whose schema is about to be replaced by the database's — asked first. */
  let pullingInto = $state<{ id: string; name: string } | null>(null);
  const pull = useAsyncAction(async (projectId: string) => {
    pullMessage = null;
    const res = await pullDatabaseSchema(projectId, initial!.id);
    pullMessage = t("connections.pulledSuccess", { count: res.tablesCount });
  });
</script>

<Modal
  title={initial ? t("connections.editConnection") : t("connections.newConnection")}
  {onClose}
  wide
  dismissable={!save.pending}
>
  <div class="space-y-4">
    <div>
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class={LABEL}>{t("common.name")}</label>
      <input class={`${INPUT_CLASS} w-full`} bind:value={name} placeholder="ex: Production DB" />
    </div>

    <ConnectionFormFields
      showCredentials={!personalPossible || authMode === "shared"}
      bind:environmentId
      bind:engine
      bind:host
      bind:port
      bind:database
      bind:user
      bind:password
      passwordPlaceholder={initial?.hasPassword ? "••••••••" : ""}
      bind:ssl
      bind:connectionString
      bind:filePath
      bind:useUri
    />

    <div>
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class={LABEL}>{t("admin.connections.tags")}</label>
      <input class={`${INPUT_CLASS} w-full`} bind:value={tags} placeholder={t("admin.connections.tagsPlaceholder")} />
    </div>

    <Checkbox bind:checked={readOnly} hint={t("admin.connections.readOnlyHint")}>
      {t("admin.connections.readOnly")}
    </Checkbox>

    {#if personalPossible}
      <div>
        <div id="auth-mode-label" class={LABEL}>{t("admin.connections.authMode")}</div>
        <RadioGroup
          bind:value={authMode}
          aria-labelledby="auth-mode-label"
          options={[
            { value: "shared", label: t("admin.connections.authShared"), hint: t("admin.connections.authSharedHint") },
            {
              value: "personal",
              label: t("admin.connections.authPersonal"),
              hint: t("admin.connections.authPersonalHint"),
            },
          ]}
        />
        {#if authMode === "personal" && initial}
          <p class="m-0 mt-2 text-xs text-text-muted" data-testid="credential-holders">
            {(holders.data ?? []).length > 0
              ? t("admin.connections.authHolders", {
                  count: (holders.data ?? []).length,
                  people: (holders.data ?? []).map((holder) => `${holder.email} (${holder.username})`).join(", "),
                })
              : t("admin.connections.authNoHolder")}
          </p>
        {/if}
      </div>
    {/if}

    <div>
      <div id="structure-policy-label" class={LABEL}>{t("dbadmin.structure.settingTitle")}</div>
      <Hint>{t("dbadmin.structure.settingHint")}</Hint>
      <RadioGroup
        bind:value={structurePolicy}
        aria-labelledby="structure-policy-label"
        options={[
          { value: "inherit", label: t("dbadmin.structure.inherit"), hint: t("dbadmin.structure.inheritHint") },
          {
            value: "schema-only",
            label: t("dbadmin.structure.policy.schema-only"),
            hint: t("dbadmin.structure.policyHint.schema-only"),
          },
          { value: "warn", label: t("dbadmin.structure.policy.warn"), hint: t("dbadmin.structure.policyHint.warn") },
          { value: "free", label: t("dbadmin.structure.policy.free"), hint: t("dbadmin.structure.policyHint.free") },
        ]}
      />
      {#if structurePolicy === "schema-only" || structurePolicy === "warn"}
        <Checkbox bind:checked={structureApplyToSql} class="mt-2.5" hint={t("dbadmin.structure.applyToSqlHint")}>
          {t("dbadmin.structure.applyToSql")}
        </Checkbox>
      {/if}
    </div>

    <div>
      <div class={LABEL}>{t("admin.connections.projects")}</div>
      <Hint>{t("admin.connections.projectsHint")}</Hint>
      {#if namesDatabase}<Hint>{t("admin.connections.projectDatabaseHint")}</Hint>{/if}
      {#if projects.error}<ErrorText>{projects.error}</ErrorText>{/if}
      <div class="max-h-44 space-y-0.5 overflow-y-auto rounded-md border border-border p-1.5">
        {#each activeProjects as project (project.id)}
          <div class="flex items-center gap-2 rounded-sm px-1.5 py-1 text-xs hover:bg-surface-hover">
            <Checkbox
              class="min-w-0 flex-1"
              checked={projectIds.includes(project.id)}
              onChange={(checked) =>
                (projectIds = checked ? [...projectIds, project.id] : projectIds.filter((id) => id !== project.id))}
            >
              <span class="block truncate text-xs">{project.name}</span>
            </Checkbox>
            {#if namesDatabase && projectIds.includes(project.id)}
              <input
                class={`${INPUT_SM_CLASS} w-44 font-mono`}
                bind:value={projectDatabases[project.id]}
                placeholder={database || t("admin.connections.projectDatabase")}
                aria-label={t("admin.connections.projectDatabaseFor", { project: project.name })}
              />
            {/if}
            <!-- Only for links that are already saved: the server refuses these for a project the connection isn't attached to yet. -->
            {#if initial && linkedIds.has(project.id)}
              <Button
                size="xs"
                variant="ghost"
                disabled={pull.pending}
                onclick={() => (pullingInto = { id: project.id, name: project.name })}
              >
                {t("connections.pullSchema")}
              </Button>
              <Button size="xs" variant="ghost" onclick={() => onCheckDifferences(project.id, initial.id)}>
                {t("connections.checkDifferences")}
              </Button>
            {/if}
          </div>
        {/each}
        {#if activeProjects.length === 0}
          <p class="py-3 text-center text-xs text-text-muted">
            {projects.loading ? t("common.loading") : t("admin.connections.noProjects")}
          </p>
        {/if}
      </div>
      {#if namesDatabase && links.some((link) => link.database)}
        <Checkbox bind:checked={createDatabases} class="mt-2" hint={t("admin.connections.createDatabasesHint")}>
          {t("admin.connections.createDatabases")}
        </Checkbox>
      {/if}
      {#if pullMessage}<Hint>{pullMessage}</Hint>{/if}
      {#if pull.error}<ErrorText>{pull.error}</ErrorText>{/if}
    </div>

    {#if testResult}
      <div
        class={`flex items-center gap-2 rounded-sm border p-2 text-xs ${
          testResult.ok
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
            : "border-rose-500/30 bg-rose-500/10 text-rose-400"
        }`}
      >
        {#if testResult.ok}<Icon icon={CheckCircleIcon} size={14} />{/if}
        <span>{testResult.message}</span>
      </div>
    {/if}
    {#if save.error}<ErrorText>{save.error}</ErrorText>{/if}

    <div class="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
      <Button size="sm" variant="ghost" onclick={() => void test.run()} disabled={test.pending}>
        {test.pending ? t("common.loading") : t("connections.testConnection")}
      </Button>
      <div class="flex items-center gap-2">
        <Button size="sm" variant="ghost" onclick={onClose} disabled={save.pending}>{t("common.cancel")}</Button>
        <Button size="sm" variant="primary" onclick={() => void save.run()} disabled={save.pending || !name.trim()}>
          <Icon icon={CheckIcon} size={13} />
          {save.pending ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </div>
  </div>
</Modal>

{#if pullingInto}
  <ConfirmDialog
    title={t("connections.confirmPullTitle", { project: pullingInto.name })}
    message={t("connections.confirmPull")}
    danger="warning"
    confirmLabel={t("connections.confirmPullRun")}
    onCancel={() => (pullingInto = null)}
    onConfirm={() => {
      const target = pullingInto;
      pullingInto = null;
      if (target) void pull.run(target.id);
    }}
  />
{/if}
