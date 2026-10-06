<script lang="ts" module>
  import type { ApiKeyScope } from "@/services/apiKeysApi";
  import type { TranslationKeyOf } from "@/types";

  /**
   * Self-service `/api/v1` key management — create, list (redacted), revoke.
   * Closes the gap the billing tab used to describe explicitly ("there is no
   * public API and no API keys yet"); see `docs/todo.md` Phase 21.
   *
   * The plaintext key is shown exactly once, right after creation — the server
   * only ever stores its hash (`apiKeys/repository.ts`), so this component is
   * the only place in the app it's ever visible.
   */
  const SCOPE_LABEL_KEY: Record<ApiKeyScope, TranslationKeyOf> = {
    "projects:read": "settings.billing.apiKeys.scope.read",
    "projects:write": "settings.billing.apiKeys.scope.write",
    "deployments:trigger": "settings.billing.apiKeys.scope.deploy",
    "connections:manage": "settings.billing.apiKeys.scope.connections",
    "teams:manage": "settings.billing.apiKeys.scope.teams",
  };
</script>

<script lang="ts">
  import Button from "@/components/ui/Button.svelte";
  import Field from "@/components/ui/Field.svelte";
  import Badge from "@/components/ui/Badge.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { formatRelativeTime } from "@/i18n/formatters";
  import { i18n, useTranslation } from "@/i18n/i18n.svelte";
  import { untrack } from "svelte";
  import Select, { type SelectOption } from "@/components/ui/Select.svelte";
  import {
    API_KEY_SCOPES,
    createApiKey,
    listApiKeys,
    revokeApiKey,
    type CreatedApiKey,
  } from "@/services/apiKeysApi";
  import { fetchProjects } from "@/services/projectsApi";
  import { copyText } from "@/utils/clipboard";

  const projectLabelId = $props.id();

  /** `projectId` — the project open behind the in-editor settings modal; a new key is offered for it by default. */
  let { projectId: currentProjectId }: { projectId?: string } = $props();

  const { t } = useTranslation();
  const keys = useAsyncResource(listApiKeys);
  const projects = useAsyncResource(fetchProjects);
  let name = $state("");
  let scopes = $state.raw<ApiKeyScope[]>([]);
  /** `null` — the key follows every project its owner can see. */
  let projectId = $state<string | null>(untrack(() => currentProjectId ?? null));
  let justCreated = $state.raw<CreatedApiKey | null>(null);
  let copied = $state(false);

  const create = useAsyncAction(async () => {
    justCreated = await createApiKey(name.trim(), scopes, projectId ?? undefined);
    copied = false;
    name = "";
    scopes = [];
    keys.reload();
  });

  const revoke = useAsyncAction(async (id: string) => {
    await revokeApiKey(id);
    keys.reload();
  });

  function toggleScope(scope: ApiKeyScope) {
    scopes = scopes.includes(scope) ? scopes.filter((s) => s !== scope) : [...scopes, scope];
  }

  async function copyKey(plaintextKey: string) {
    copied = await copyText(plaintextKey);
  }

  const projectOptions = $derived<SelectOption<string | null>[]>([
    { value: null, label: t("settings.billing.apiKeys.allProjects") },
    ...(projects.data ?? []).map((project) => ({ value: project.id, label: project.name })),
  ]);
  const projectName = (id: string) => projects.data?.find((project) => project.id === id)?.name ?? id;

  /** A ready-to-paste first call for the key just created — the one thing a new key's owner does next. */
  const example = $derived.by(() => {
    if (!justCreated) return "";
    const restrictedTo = justCreated.summary.projectId;
    const path = restrictedTo ? `/api/v1/projects/${restrictedTo}` : "/api/v1/projects";
    return `curl -H "Authorization: Bearer ${justCreated.plaintextKey}" ${location.origin}${path}`;
  });

  const rows = $derived((keys.data ?? []).filter((k) => !k.revokedAt));
  const error = $derived(keys.error ?? projects.error ?? create.error ?? revoke.error);
</script>

<div class="space-y-4">
  <div>
    <h2 class="text-lg font-bold text-text mb-1">{t("settings.billing.apiKeysTitle")}</h2>
    <p class="text-xs text-text-muted leading-relaxed">{t("settings.billing.apiKeys.intro")}</p>
    <a
      href="/api/v1/openapi.json"
      target="_blank"
      rel="noreferrer"
      class="text-xs font-semibold text-primary hover:underline"
    >
      {t("settings.billing.apiKeys.reference")}
    </a>
  </div>

  {#if error}<ErrorText>{error}</ErrorText>{/if}

  {#if justCreated}
    {@const created = justCreated}
    <div class="rounded-lg border border-primary/50 bg-primary/10 p-3 space-y-2">
      <p class="text-xs font-semibold text-text">{t("settings.billing.apiKeys.createdOnce")}</p>
      <code class="block break-all rounded-md bg-surface-raised px-2 py-1.5 text-[11.5px] text-text">
        {created.plaintextKey}
      </code>
      <p class="text-xs text-text-muted">{t("settings.billing.apiKeys.example")}</p>
      <code class="block break-all rounded-md bg-surface-raised px-2 py-1.5 text-[11.5px] text-text-secondary">
        {example}
      </code>
      <div class="flex items-center gap-2">
        <Button size="sm" variant="primary" onclick={() => void copyKey(created.plaintextKey)}>
          {copied ? t("common.copied") : t("common.copy")}
        </Button>
        <Button size="sm" variant="outline" onclick={() => (justCreated = null)}>
          {t("settings.billing.apiKeys.dismiss")}
        </Button>
      </div>
    </div>
  {/if}

  <ul class="space-y-2 max-w-2xl">
    {#each rows as key (key.id)}
      <li class="flex items-center gap-3 rounded-lg border border-border/70 bg-surface/60 px-3 py-2 text-xs">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-semibold text-text truncate">{key.name}</span>
            <code class="text-[11px] text-text-muted">{key.keyPrefix}…</code>
            {#each key.scopes as scope (scope)}
              <Badge tone="muted">{t(SCOPE_LABEL_KEY[scope])}</Badge>
            {/each}
          </div>
          <div class="text-text-muted mt-0.5">
            {key.projectId ? projectName(key.projectId) : t("settings.billing.apiKeys.allProjects")} ·
            {key.lastUsedAt
              ? t("settings.billing.apiKeys.lastUsed", { time: formatRelativeTime(key.lastUsedAt, i18n.locale) })
              : t("settings.billing.apiKeys.neverUsed")}
          </div>
        </div>
        <Button variant="danger-ghost" size="sm" disabled={revoke.pending} onclick={() => void revoke.run(key.id)}>
          {t("settings.billing.apiKeys.revoke")}
        </Button>
      </li>
    {/each}
  </ul>

  <div class="max-w-md pt-2">
    <Field
      label={t("settings.billing.apiKeys.nameLabel")}
      bind:value={name}
      placeholder={t("settings.billing.apiKeys.namePlaceholder")}
    />
    <div class="mb-4 space-y-1.5">
      <span id={projectLabelId} class="block text-xs font-semibold text-text">
        {t("settings.billing.apiKeys.projectLabel")}
      </span>
      <Select bind:value={projectId} options={projectOptions} size="sm" class="w-full" aria-labelledby={projectLabelId} />
      <p class="text-xs text-text-muted">{t("settings.billing.apiKeys.projectHint")}</p>
    </div>
    <div class="flex flex-col gap-1.5 mb-4">
      {#each API_KEY_SCOPES as scope (scope)}
        <Checkbox checked={scopes.includes(scope)} onChange={() => toggleScope(scope)}>
          <span class="text-xs text-text-secondary">{t(SCOPE_LABEL_KEY[scope])}</span>
        </Checkbox>
      {/each}
    </div>
    <Button
      variant="primary"
      size="sm"
      disabled={create.pending || !name.trim() || scopes.length === 0}
      onclick={() => void create.run()}
    >
      {t("settings.billing.apiKeys.create")}
    </Button>
  </div>
</div>
