<script lang="ts" module>
  import type { ApiKeyScope } from "@/services/apiKeysApi";
  import type { TranslationKeyOf } from "@/types";

  /**
   * Connecting an AI agent (Claude Code, Claude Desktop, Cursor…) through the MCP server
   * (`packages/mcp`). An agent's key is an API key of kind `agent`: the server caps it below its
   * owner — at most `deploy` on a project, never a project's creation or deletion, never any
   * administration (`apiKeys/repository.ts`, `shared/permissions.ts`). This tab only picks what
   * the agent may do among that; the server is what enforces it.
   */
  const CAPABILITY_LABEL_KEY: Record<string, TranslationKeyOf> = {
    "projects:read": "settings.aiAgent.capability.read",
    "projects:write": "settings.aiAgent.capability.write",
    "deployments:trigger": "settings.aiAgent.capability.deploy",
    "sql:execute": "settings.aiAgent.capability.sql",
  };
  const CAPABILITY_HINT_KEY: Record<string, TranslationKeyOf> = {
    "projects:read": "settings.aiAgent.capability.readHint",
    "projects:write": "settings.aiAgent.capability.writeHint",
    "deployments:trigger": "settings.aiAgent.capability.deployHint",
    "sql:execute": "settings.aiAgent.capability.sqlHint",
  };
  const DEFAULT_SCOPES: ApiKeyScope[] = ["projects:read", "projects:write"];
</script>

<script lang="ts">
  import Button from "@/components/ui/Button.svelte";
  import Field from "@/components/ui/Field.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import Select, { type SelectOption } from "@/components/ui/Select.svelte";
  import SegmentedControl from "@/components/ui/SegmentedControl.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatRelativeTime } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { untrack } from "svelte";
  import {
    AGENT_KEY_SCOPES,
    createApiKey,
    listApiKeys,
    revokeApiKey,
    type CreatedApiKey,
  } from "@/services/apiKeysApi";
  import { fetchProjects } from "@/services/projectsApi";
  import { copyText } from "@/utils/clipboard";
  import { buildMcpSetup, type McpClient } from "./mcpSetup";

  const projectLabelId = $props.id();

  /** `projectId` — the project open behind the in-editor settings modal; offered by default. */
  let { projectId: currentProjectId }: { projectId?: string } = $props();

  const { t } = useTranslation();
  const keys = useAsyncResource(listApiKeys);
  const projects = useAsyncResource(fetchProjects);
  let name = $state("");
  let scopes = $state.raw<ApiKeyScope[]>(DEFAULT_SCOPES);
  let projectId = $state<string | null>(untrack(() => currentProjectId ?? null));
  let justCreated = $state.raw<CreatedApiKey | null>(null);
  let client = $state<McpClient>("claudeCode");
  let copied = $state<string | null>(null);
  /** The key whose revocation waits for a second click, shown in its own row (no dialog). */
  let confirmingRevoke = $state<string | null>(null);
  let revoked = $state<string | null>(null);

  const create = useAsyncAction(async () => {
    justCreated = await createApiKey(name.trim(), scopes, projectId ?? undefined, "agent");
    copied = null;
    name = "";
    scopes = DEFAULT_SCOPES;
    keys.reload();
  });

  const revoke = useAsyncAction(async (id: string, keyName: string) => {
    await revokeApiKey(id);
    confirmingRevoke = null;
    revoked = keyName;
    keys.reload();
  });

  function toggleScope(scope: ApiKeyScope) {
    if (scope === "projects:read") return; // always on: an agent finds its way by reading
    scopes = scopes.includes(scope) ? scopes.filter((s) => s !== scope) : [...scopes, scope];
  }

  async function copy(what: string, text: string) {
    copied = (await copyText(text)) ? what : null;
  }

  const projectOptions = $derived<SelectOption<string | null>[]>([
    { value: null, label: t("settings.billing.apiKeys.allProjects") },
    ...(projects.data ?? []).map((project) => ({ value: project.id, label: project.name })),
  ]);
  const projectName = (id: string) => projects.data?.find((project) => project.id === id)?.name ?? id;

  const clientOptions = $derived([
    { value: "claudeCode" as const, label: "Claude Code" },
    { value: "claudeDesktop" as const, label: "Claude Desktop" },
    { value: "cursor" as const, label: "Cursor" },
  ]);

  const setup = $derived(justCreated ? buildMcpSetup(client, location.origin, justCreated.plaintextKey) : null);
  const rows = $derived((keys.data ?? []).filter((k) => !k.revokedAt && k.kind === "agent"));
  const error = $derived(keys.error ?? projects.error ?? create.error ?? revoke.error);
</script>

<div class="space-y-5">
  <div>
    <h2 class="text-lg font-bold text-text mb-1">{t("settings.aiAgent.title")}</h2>
    <p class="text-xs text-text-muted leading-relaxed max-w-2xl">{t("settings.aiAgent.intro")}</p>
  </div>

  <div class="grid gap-3 sm:grid-cols-2 max-w-2xl">
    <div class="rounded-lg border border-border/70 bg-surface/60 p-3">
      <p class="text-xs font-semibold text-text mb-1.5">{t("settings.aiAgent.can")}</p>
      <ul class="list-disc pl-4 space-y-0.5 text-xs text-text-secondary">
        <li>{t("settings.aiAgent.can.read")}</li>
        <li>{t("settings.aiAgent.can.edit")}</li>
        <li>{t("settings.aiAgent.can.history")}</li>
        <li>{t("settings.aiAgent.can.deploy")}</li>
        <li>{t("settings.aiAgent.can.sql")}</li>
      </ul>
    </div>
    <div class="rounded-lg border border-border/70 bg-surface/60 p-3">
      <p class="text-xs font-semibold text-text mb-1.5">{t("settings.aiAgent.cannot")}</p>
      <ul class="list-disc pl-4 space-y-0.5 text-xs text-text-secondary">
        <li>{t("settings.aiAgent.cannot.projects")}</li>
        <li>{t("settings.aiAgent.cannot.admin")}</li>
        <li>{t("settings.aiAgent.cannot.decide")}</li>
        <li>{t("settings.aiAgent.cannot.beyond")}</li>
      </ul>
    </div>
  </div>

  {#if error}<ErrorText>{error}</ErrorText>{/if}
  {#if revoked}
    <p class="text-xs text-text-secondary" role="status">{t("settings.aiAgent.revoked", { name: revoked })}</p>
  {/if}

  {#if justCreated && setup}
    {@const created = justCreated}
    <div class="rounded-lg border border-primary/50 bg-primary/10 p-3 space-y-3 max-w-2xl" role="status">
      <p class="text-xs font-semibold text-text">{t("settings.aiAgent.createdOnce")}</p>
      <div class="flex items-center gap-2">
        <code class="flex-1 min-w-0 break-all rounded-md bg-surface-raised px-2 py-1.5 text-label text-text">
          {created.plaintextKey}
        </code>
        <Button size="sm" variant="outline" onclick={() => void copy("key", created.plaintextKey)}>
          {copied === "key" ? t("common.copied") : t("common.copy")}
        </Button>
      </div>

      <div class="space-y-1.5">
        <p class="text-xs font-semibold text-text">{t("settings.aiAgent.setupTitle")}</p>
        <SegmentedControl bind:value={client} options={clientOptions} size="sm" />
        <p class="text-xs text-text-muted">{t(setup.hintKey)}</p>
        <pre
          class="whitespace-pre-wrap break-all rounded-md bg-surface-raised px-2 py-1.5 text-label text-text-secondary">{setup.snippet}</pre>
        <div class="flex items-center gap-2">
          <Button size="sm" variant="primary" onclick={() => void copy("setup", setup.snippet)}>
            {copied === "setup" ? t("common.copied") : t("settings.aiAgent.copySetup")}
          </Button>
          <Button size="sm" variant="outline" onclick={() => (justCreated = null)}>
            {t("settings.billing.apiKeys.dismiss")}
          </Button>
        </div>
      </div>
    </div>
  {/if}

  {#if rows.length > 0}
    <ul class="space-y-2 max-w-2xl">
      {#each rows as key (key.id)}
        <li class="rounded-lg border border-border/70 bg-surface/60 px-3 py-2 text-xs">
          <div class="flex items-center gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-semibold text-text truncate">{key.name}</span>
                <code class="text-caption text-text-muted">{key.keyPrefix}…</code>
                {#each key.scopes as scope (scope)}
                  {#if CAPABILITY_LABEL_KEY[scope]}<Badge tone="muted">{t(CAPABILITY_LABEL_KEY[scope])}</Badge>{/if}
                {/each}
              </div>
              <div class="text-text-muted mt-0.5">
                {key.projectId ? projectName(key.projectId) : t("settings.billing.apiKeys.allProjects")} ·
                {key.lastUsedAt
                  ? t("settings.billing.apiKeys.lastUsed", { time: formatRelativeTime(key.lastUsedAt, i18n.locale) })
                  : t("settings.billing.apiKeys.neverUsed")}
              </div>
            </div>
            {#if confirmingRevoke !== key.id}
              <Button variant="danger-ghost" size="sm" onclick={() => (confirmingRevoke = key.id)}>
                {t("settings.billing.apiKeys.revoke")}
              </Button>
            {/if}
          </div>
          {#if confirmingRevoke === key.id}
            <div class="mt-2 flex items-center gap-2 flex-wrap border-t border-border/60 pt-2">
              <span class="flex-1 text-text-secondary">{t("settings.aiAgent.revokeConfirm")}</span>
              <Button
                variant="danger"
                size="sm"
                disabled={revoke.pending}
                onclick={() => void revoke.run(key.id, key.name)}
              >
                {t("settings.billing.apiKeys.revoke")}
              </Button>
              <Button variant="outline" size="sm" onclick={() => (confirmingRevoke = null)}>
                {t("common.cancel")}
              </Button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <div class="max-w-md pt-2">
    <h3 class="text-sm font-semibold text-text mb-2">{t("settings.aiAgent.newTitle")}</h3>
    <Field
      label={t("settings.billing.apiKeys.nameLabel")}
      bind:value={name}
      placeholder={t("settings.aiAgent.namePlaceholder")}
    />
    <div class="mb-4 space-y-1.5">
      <span id={projectLabelId} class="block text-xs font-semibold text-text">
        {t("settings.billing.apiKeys.projectLabel")}
      </span>
      <Select bind:value={projectId} options={projectOptions} size="sm" class="w-full" aria-labelledby={projectLabelId} />
      <p class="text-xs text-text-muted">{t("settings.aiAgent.projectHint")}</p>
    </div>
    <div class="flex flex-col gap-2 mb-4">
      {#each AGENT_KEY_SCOPES as scope (scope)}
        <Checkbox
          checked={scopes.includes(scope)}
          disabled={scope === "projects:read"}
          onChange={() => toggleScope(scope)}
        >
          <span class="text-xs text-text-secondary">
            <span class="font-semibold text-text">{t(CAPABILITY_LABEL_KEY[scope])}</span>
            — {t(CAPABILITY_HINT_KEY[scope])}
          </span>
        </Checkbox>
      {/each}
    </div>
    <p class="text-xs text-text-muted mb-3">{t("settings.aiAgent.withinPermissions")}</p>
    <Button variant="primary" size="sm" disabled={create.pending || !name.trim()} onclick={() => void create.run()}>
      {t("settings.aiAgent.create")}
    </Button>
  </div>
</div>
