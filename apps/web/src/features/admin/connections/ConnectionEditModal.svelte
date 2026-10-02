<script lang="ts">
  import type { AdminConnectionSummary, DatabaseEngine } from "@athanordb/shared";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { CheckCircleIcon, CheckIcon } from "@/components/icons/Icons";
  import { CHECKBOX_CLASS, INPUT_CLASS } from "@/components/ui/inputStyles";
  import ConnectionFormFields, { DEFAULT_PORTS } from "@/features/connections/ConnectionFormFields.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { describeApiError } from "@/i18n/serverErrorMessages";
  import { pullDatabaseSchema } from "@/services/connectionsApi";
  import {
    createAdminConnection,
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
  let environment = $state(initial?.environment ?? "");
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
  let projectIds = $state<string[]>((initial?.projects ?? []).map((p) => p.id));

  const projects = useAsyncResource(fetchProjects);
  const activeProjects = $derived((projects.data ?? []).filter((p) => p.status === "active"));
  const linkedIds = $derived(new Set((initial?.projects ?? []).map((p) => p.id)));

  function payload(): AdminConnectionInput {
    const network = !useUri && engine !== "sqlite";
    return {
      name: name.trim(),
      environment: environment.trim(),
      engine,
      host: network ? host : undefined,
      port: network ? Number(port) : undefined,
      database: network ? database : undefined,
      user: network ? user : undefined,
      password: network ? password || undefined : undefined,
      ssl: network ? ssl : undefined,
      connectionString: useUri && engine !== "sqlite" ? connectionString : undefined,
      filePath: engine === "sqlite" ? filePath : undefined,
      tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      readOnly,
    };
  }

  let testResult = $state.raw<{ ok: boolean; message: string } | null>(null);
  const test = useAsyncAction(async () => {
    testResult = null;
    try {
      const res = await testAdminConnection(payload(), initial?.id);
      testResult = res.ok
        ? { ok: true, message: `${t("connections.testSuccess")}: ${res.version ?? ""} ${res.database ? `(${res.database})` : ""}` }
        : { ok: false, message: res.error || t("connections.testFailed") };
    } catch (err) {
      testResult = { ok: false, message: describeApiError(err, t) };
    }
  });

  const save = useAsyncAction(async () => {
    const saved = initial ? await updateAdminConnection(initial.id, payload()) : await createAdminConnection(payload());
    const before = [...linkedIds].sort().join();
    if ([...projectIds].sort().join() !== before) await setAdminConnectionProjects(saved.id, projectIds);
    onSaved();
  });

  let pullMessage = $state<string | null>(null);
  const pull = useAsyncAction(async (projectId: string) => {
    pullMessage = null;
    const res = await pullDatabaseSchema(projectId, initial!.id);
    pullMessage = t("connections.pulledSuccess", { count: res.tablesCount });
  });
</script>

<Modal title={initial ? t("connections.editConnection") : t("connections.newConnection")} {onClose} wide dismissable={!save.pending}>
  <div class="space-y-4">
    <div>
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label class={LABEL}>{t("common.name")}</label>
      <input class={`${INPUT_CLASS} w-full`} bind:value={name} placeholder="ex: Production DB" />
    </div>

    <ConnectionFormFields
      bind:environment
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

    <label class="flex cursor-pointer items-start gap-2 text-xs text-text">
      <input type="checkbox" class={`${CHECKBOX_CLASS} mt-0.5`} bind:checked={readOnly} />
      <span>
        <span class="font-semibold">{t("admin.connections.readOnly")}</span>
        <span class="block text-text-muted">{t("admin.connections.readOnlyHint")}</span>
      </span>
    </label>

    <div>
      <div class={LABEL}>{t("admin.connections.projects")}</div>
      <Hint>{t("admin.connections.projectsHint")}</Hint>
      {#if projects.error}<ErrorText>{projects.error}</ErrorText>{/if}
      <div class="max-h-44 space-y-0.5 overflow-y-auto rounded-md border border-border p-1.5">
        {#each activeProjects as project (project.id)}
          <div class="flex items-center gap-2 rounded-sm px-1.5 py-1 text-xs hover:bg-surface-hover">
            <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
              <input type="checkbox" class={CHECKBOX_CLASS} value={project.id} bind:group={projectIds} />
              <span class="truncate">{project.name}</span>
            </label>
            <!-- Only for links that are already saved: the server refuses these for a project the connection isn't attached to yet. -->
            {#if initial && linkedIds.has(project.id)}
              <Button
                size="xs"
                variant="ghost"
                disabled={pull.pending}
                onclick={() => {
                  if (window.confirm(t("connections.confirmPull"))) void pull.run(project.id);
                }}
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
