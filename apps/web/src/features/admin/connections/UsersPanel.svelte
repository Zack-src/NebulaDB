<script lang="ts">
  import type { DatabaseEngine, DbGrant, DbGrantScope, DbPrincipal, DbPrincipalRef, DbUserAction } from "@athanordb/shared";
  import Icon from "@/components/icons/Icon.svelte";
  import { CloseIcon, KeyIcon, PlusIcon, TrashIcon, UserIcon, UsersIcon } from "@/components/icons/Icons";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import { CHECKBOX_CLASS, INPUT_SM_CLASS, SELECT_SM_CLASS } from "@/components/ui/inputStyles";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { applyUserAction, fetchGrants, fetchPrincipals, type ConnectionOverview } from "@/services/dbAdminApi";
  import StatementModal from "./StatementModal.svelte";

  /**
   * Accounts, roles and privileges of the target server, in one model for
   * every engine — the server maps it to each engine's own statements, and
   * `overview.capabilities` says which parts apply (a host for MySQL accounts,
   * a server/database level for SQL Server). Nothing here writes directly:
   * each button builds a `DbUserAction` and hands it to `StatementModal`.
   */
  let {
    connectionId,
    engine,
    overview,
  }: { connectionId: string; engine: DatabaseEngine; overview: ConnectionOverview } = $props();

  const SERVER_LEVEL = "";
  /** The SQL Server keyword, shown as such in every language. */
  const DENY_LABEL = "DENY";
  const { t } = useTranslation();
  const capabilities = $derived(overview.capabilities);
  // MySQL accounts and privileges are server-wide; elsewhere the database is either a level (SQL Server) or the context grants are read in (PostgreSQL).
  const hasDatabaseContext = $derived(capabilities.multiDatabase && engine !== "mysql");

  // svelte-ignore state_referenced_locally
  let context = $state(
    capabilities.principalLevels ? SERVER_LEVEL : (overview.defaultDatabase ?? overview.databases.find((d) => !d.system)?.name ?? ""),
  );
  let filter = $state("");
  let selectedKey = $state<string | null>(null);
  let pending = $state.raw<{ title: string; action: DbUserAction; danger?: boolean; confirmName?: string } | null>(null);

  /** The database a principal lives in — only SQL Server has principals below server level. */
  const principalDatabase = $derived(capabilities.principalLevels && context !== SERVER_LEVEL ? context : undefined);
  // Where principals exist at two levels, each level only takes its own kind of privilege:
  // server permissions for a login, database/schema/table ones for a database user.
  const scopes = $derived(
    (Object.keys(overview.privileges) as DbGrantScope[]).filter(
      (scope) => !capabilities.principalLevels || (scope === "server") === !principalDatabase,
    ),
  );
  const principals = useAsyncResource(() => fetchPrincipals(connectionId, principalDatabase));
  const keyOf = (p: { name: string; host?: string }) => `${p.name}@${p.host ?? ""}`;
  const visible = $derived((principals.data ?? []).filter((p) => p.name.toLowerCase().includes(filter.trim().toLowerCase())));
  const selected = $derived((principals.data ?? []).find((p) => keyOf(p) === selectedKey) ?? null);
  const roles = $derived((principals.data ?? []).filter((p) => p.kind === "role" && !p.system).map((p) => p.name));

  function refOf(p: DbPrincipal): DbPrincipalRef {
    return { name: p.name, host: p.host, kind: p.kind, database: principalDatabase };
  }

  const grants = useAsyncResource(() =>
    selected
      ? fetchGrants(connectionId, { ...refOf(selected), database: hasDatabaseContext && context !== SERVER_LEVEL ? context : undefined })
      : Promise.resolve([] as DbGrant[]),
  );

  // ---- Create form ----
  let creating = $state(false);
  let newName = $state("");
  let newHost = $state("%");
  let newKind = $state<"user" | "role">("user");
  let newPassword = $state("");
  /** SQL Server database users are mapped to an existing login and carry no password of their own. */
  const createNeedsPassword = $derived(newKind === "user" && !principalDatabase);

  function generatePassword() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789-_+=";
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    newPassword = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  }

  function submitCreate() {
    pending = {
      title: t("dbadmin.users.createTitle"),
      action: {
        type: "create",
        principal: { name: newName.trim(), host: capabilities.principalHost && newKind === "user" ? newHost.trim() || "%" : undefined, kind: newKind, database: principalDatabase },
        password: createNeedsPassword ? newPassword : undefined,
      },
    };
  }

  // ---- Password ----
  let changingPassword = $state(false);
  let passwordValue = $state("");

  // ---- Grant form ----
  let grantScope = $state<DbGrantScope>("table");
  let grantDatabase = $state("");
  let grantSchema = $state("");
  let grantTable = $state("");
  let grantPrivileges = $state<string[]>([]);
  let grantOption = $state(false);
  $effect(() => {
    if (!scopes.includes(grantScope) && scopes.length > 0) grantScope = scopes[scopes.length - 1];
  });
  $effect(() => {
    void grantScope;
    grantPrivileges = [];
  });
  const needsDatabase = $derived(grantScope !== "server" && capabilities.multiDatabase && !principalDatabase);
  const needsSchema = $derived(capabilities.schemas && (grantScope === "schema" || grantScope === "table"));
  const needsTable = $derived(grantScope === "table");

  function grantTarget() {
    const database = principalDatabase ?? (needsDatabase ? grantDatabase || context || undefined : undefined);
    return {
      database: grantScope === "server" ? undefined : database,
      schema: needsSchema ? grantSchema.trim() || undefined : undefined,
      table: needsTable ? grantTable.trim() || undefined : undefined,
    };
  }

  function submitGrant(p: DbPrincipal) {
    pending = {
      title: t("dbadmin.users.grantTitle", { name: p.name }),
      action: { type: "grant", principal: refOf(p), scope: grantScope, privileges: grantPrivileges, target: grantTarget(), withGrantOption: grantOption },
    };
  }

  function revoke(p: DbPrincipal, grant: DbGrant) {
    pending = {
      title: t("dbadmin.users.revokeTitle", { name: p.name }),
      danger: true,
      action: {
        type: "revoke",
        principal: refOf(p),
        scope: grant.scope,
        // A column-level entry reads `SELECT (col)`; the privilege itself is what gets revoked.
        privileges: grant.privileges.map((privilege) => privilege.replace(/\s*\(.*$/, "")),
        target: { database: grant.database, schema: grant.schema, table: grant.table },
      },
    };
  }

  let roleToAdd = $state("");

  function describeGrant(grant: DbGrant): string {
    if (grant.scope === "server") return t("dbadmin.users.scope.server");
    return [grant.database, grant.schema, grant.table ?? (grant.scope === "table" ? "*" : undefined)].filter(Boolean).join(".");
  }

  function done() {
    // A dropped principal must not stay selected: its grants can no longer be read.
    if (pending?.action.type === "drop") selectedKey = null;
    pending = null;
    creating = false;
    changingPassword = false;
    passwordValue = "";
    newName = "";
    newPassword = "";
    principals.reload();
    grants.reload();
  }

  const readOnlyTip = $derived(overview.readOnly ? t("dbadmin.readOnlyConnection") : undefined);
  /** PostgreSQL has no lock flag: "locking" a role is taking LOGIN away, so it applies to roles too. */
  const canToggleLogin = (p: DbPrincipal) => !principalDatabase && (p.kind === "user" || engine === "postgres");
</script>

<div class="grid grid-cols-1 gap-4 md:grid-cols-12">
  <div class="space-y-2 md:col-span-4">
    {#if hasDatabaseContext}
      <select class={`${SELECT_SM_CLASS} w-full`} bind:value={context} aria-label={t("dbadmin.users.level")}>
        {#if capabilities.principalLevels}<option value={SERVER_LEVEL}>{t("dbadmin.users.serverLevel")}</option>{/if}
        {#each overview.databases as db (db.name)}
          <option value={db.name}>{db.name}</option>
        {/each}
      </select>
    {/if}
    <div class="flex items-center gap-1">
      <input class={`${INPUT_SM_CLASS} min-w-0 flex-1`} bind:value={filter} placeholder={t("dbadmin.users.filter")} />
      <Button size="sm" variant="primary" disabled={overview.readOnly} data-tooltip={readOnlyTip} onclick={() => (creating = !creating)}>
        <Icon icon={PlusIcon} size={12} />
        {t("common.add")}
      </Button>
    </div>

    {#if creating}
      <div class="space-y-2 rounded-md border border-border bg-surface-raised p-2.5">
        <select class={`${SELECT_SM_CLASS} w-full`} bind:value={newKind}>
          <option value="user">{t("dbadmin.users.kind.user")}</option>
          <option value="role">{t("dbadmin.users.kind.role")}</option>
        </select>
        <input class={`${INPUT_SM_CLASS} w-full`} bind:value={newName} placeholder={t("common.name")} autocomplete="off" />
        {#if capabilities.principalHost && newKind === "user"}
          <input class={`${INPUT_SM_CLASS} w-full`} bind:value={newHost} placeholder={t("dbadmin.users.host")} autocomplete="off" />
        {/if}
        {#if createNeedsPassword}
          <div class="flex items-center gap-1">
            <input class={`${INPUT_SM_CLASS} min-w-0 flex-1 font-mono`} bind:value={newPassword} placeholder={t("connections.password")} autocomplete="off" />
            <Button size="sm" variant="ghost" onclick={generatePassword}>{t("dbadmin.users.generate")}</Button>
          </div>
          <Hint>{t("dbadmin.users.passwordOnce")}</Hint>
        {:else if newKind === "user"}
          <Hint>{t("dbadmin.users.mappedToLogin")}</Hint>
        {/if}
        <Button size="sm" variant="primary" disabled={!newName.trim() || (createNeedsPassword && !newPassword)} onclick={submitCreate}>
          {t("dbadmin.users.previewCreate")}
        </Button>
      </div>
    {/if}

    {#if principals.error}<ErrorText>{principals.error}</ErrorText>{/if}
    <div class="max-h-[460px] space-y-0.5 overflow-y-auto">
      {#each visible as p (keyOf(p))}
        {@const active = keyOf(p) === selectedKey}
        <button
          type="button"
          onclick={() => (selectedKey = keyOf(p))}
          class={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors ${
            active ? "bg-accent/15 font-semibold text-accent" : "text-text hover:bg-surface-hover"
          }`}
        >
          <Icon icon={p.kind === "role" ? UsersIcon : UserIcon} size={12} class="shrink-0 text-text-muted" />
          <span class={`min-w-0 flex-1 truncate ${p.kind === "user" && !p.canLogin ? "text-text-muted line-through" : ""}`}>
            {p.name}{#if p.host}<span class="text-text-muted">@{p.host}</span>{/if}
          </span>
          {#if p.superuser}<Badge tone="admin">{t("dbadmin.users.superuser")}</Badge>{/if}
          {#if p.system}<Badge tone="muted">{t("dbadmin.users.system")}</Badge>{/if}
        </button>
      {/each}
      {#if visible.length === 0}
        <p class="py-4 text-center text-xs text-text-muted">{principals.loading ? t("common.loading") : t("dbadmin.users.empty")}</p>
      {/if}
    </div>
  </div>

  <div class="min-w-0 space-y-4 md:col-span-8">
    {#if !selected}
      <EmptyState>{t("dbadmin.users.pick")}</EmptyState>
    {:else}
      {@const p = selected}
      {@const locked = overview.readOnly || p.system}
      {@const lockedTip = readOnlyTip ?? (p.system ? t("dbadmin.systemObject") : undefined)}
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-mono text-[13px] font-semibold">{p.name}{p.host ? `@${p.host}` : ""}</span>
        <Badge tone={p.kind === "role" ? "muted" : "success"}>{t(`dbadmin.users.kind.${p.kind}`)}</Badge>
        {#if p.kind === "user" && !p.canLogin}<Badge tone="danger">{t("dbadmin.users.locked")}</Badge>{/if}
        <div class="ml-auto flex flex-wrap items-center gap-1.5">
          {#if p.kind === "user" && !principalDatabase}
            <Button size="xs" variant="ghost" disabled={locked} data-tooltip={lockedTip} onclick={() => (changingPassword = !changingPassword)}>
              <Icon icon={KeyIcon} size={12} />
              {t("dbadmin.users.changePassword")}
            </Button>
          {/if}
          {#if canToggleLogin(p)}
            <Button
              size="xs"
              variant="ghost"
              disabled={locked}
              data-tooltip={lockedTip}
              onclick={() =>
                (pending = {
                  title: p.canLogin ? t("dbadmin.users.lockTitle", { name: p.name }) : t("dbadmin.users.unlockTitle", { name: p.name }),
                  action: { type: "lock", principal: refOf(p), locked: p.canLogin },
                })}
            >
              {p.canLogin ? t("dbadmin.users.lock") : t("dbadmin.users.unlock")}
            </Button>
          {/if}
          <Button
            size="xs"
            variant="danger"
            disabled={locked}
            data-tooltip={lockedTip}
            onclick={() =>
              (pending = {
                title: t("dbadmin.users.dropTitle", { name: p.name }),
                danger: true,
                confirmName: p.name,
                action: { type: "drop", principal: refOf(p) },
              })}
          >
            <Icon icon={TrashIcon} size={12} />
            {t("common.delete")}
          </Button>
        </div>
      </div>

      {#if changingPassword}
        <div class="flex items-center gap-1.5">
          <input class={`${INPUT_SM_CLASS} min-w-0 flex-1 font-mono`} bind:value={passwordValue} placeholder={t("dbadmin.users.newPassword")} autocomplete="off" />
          <Button
            size="sm"
            variant="primary"
            disabled={!passwordValue}
            onclick={() =>
              (pending = {
                title: t("dbadmin.users.passwordTitle", { name: p.name }),
                action: { type: "password", principal: refOf(p), password: passwordValue },
              })}
          >
            {t("dbadmin.users.previewChange")}
          </Button>
        </div>
      {/if}

      <section>
        <div class="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">{t("dbadmin.users.roles")}</div>
        <div class="flex flex-wrap items-center gap-1.5">
          {#each p.memberOf as role (role)}
            <span class="inline-flex items-center gap-1 rounded-full bg-surface-hover px-2 py-0.5 text-xs">
              {role}
              <button
                type="button"
                class="text-text-muted hover:text-danger disabled:opacity-40"
                disabled={locked}
                aria-label={t("dbadmin.users.removeRole", { role })}
                onclick={() =>
                  (pending = {
                    title: t("dbadmin.users.removeRole", { role }),
                    danger: true,
                    action: { type: "revokeRole", principal: refOf(p), role },
                  })}
              >
                <Icon icon={CloseIcon} size={10} />
              </button>
            </span>
          {/each}
          {#if p.memberOf.length === 0}<span class="text-xs text-text-muted">{t("dbadmin.users.noRoles")}</span>{/if}
          {#if roles.filter((r) => r !== p.name && !p.memberOf.includes(r)).length > 0}
            <select class={SELECT_SM_CLASS} bind:value={roleToAdd} disabled={locked}>
              <option value="">{t("dbadmin.users.addRole")}</option>
              {#each roles.filter((r) => r !== p.name && !p.memberOf.includes(r)) as role (role)}
                <option value={role}>{role}</option>
              {/each}
            </select>
            {#if roleToAdd}
              <Button
                size="xs"
                variant="primary"
                onclick={() => {
                  pending = { title: t("dbadmin.users.addRoleTitle", { role: roleToAdd, name: p.name }), action: { type: "grantRole", principal: refOf(p), role: roleToAdd } };
                  roleToAdd = "";
                }}
              >
                {t("common.add")}
              </Button>
            {/if}
          {/if}
        </div>
      </section>

      <section>
        <div class="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">{t("dbadmin.users.privileges")}</div>
        {#if grants.error}<ErrorText>{grants.error}</ErrorText>{/if}
        {#if (grants.data ?? []).length === 0}
          <Hint>{grants.loading ? t("common.loading") : t("dbadmin.users.noGrants")}</Hint>
        {:else}
          <div class="overflow-x-auto rounded-md border border-border">
            <table class="w-full border-collapse text-xs">
              <tbody>
                {#each grants.data ?? [] as grant, i (i)}
                  <tr class="border-b border-border/60 align-top last:border-b-0">
                    <td class="px-2 py-1 whitespace-nowrap text-text-muted">{t(`dbadmin.users.scope.${grant.scope}`)}</td>
                    <td class="px-2 py-1 font-mono">{grant.scope === "server" ? "" : describeGrant(grant)}</td>
                    <td class="px-2 py-1">
                      {#if grant.denied}<Badge tone="danger">{DENY_LABEL}</Badge>{/if}
                      {grant.privileges.join(", ")}
                      {#if grant.grantable}<Badge tone="warning">{t("dbadmin.users.grantable")}</Badge>{/if}
                    </td>
                    <td class="px-1 py-0.5 text-right">
                      <Button variant="danger-ghost" size="icon-xs" disabled={locked} data-tooltip={lockedTip ?? t("dbadmin.users.revoke")} onclick={() => revoke(p, grant)}>
                        <Icon icon={TrashIcon} size={11} />
                      </Button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>

      {#if !locked && scopes.length > 0}
        <section class="space-y-2 rounded-md border border-border bg-surface-raised p-2.5">
          <div class="text-xs font-semibold text-text-secondary">{t("dbadmin.users.grantNew")}</div>
          <div class="flex flex-wrap items-center gap-1.5">
            <select class={SELECT_SM_CLASS} bind:value={grantScope} aria-label={t("dbadmin.users.scopeLabel")}>
              {#each scopes as scope (scope)}
                <option value={scope}>{t(`dbadmin.users.scope.${scope}`)}</option>
              {/each}
            </select>
            {#if needsDatabase}
              <select class={SELECT_SM_CLASS} bind:value={grantDatabase} aria-label={t("dbadmin.database")}>
                <option value="">{context || t("dbadmin.database")}</option>
                {#each overview.databases.filter((d) => d.name !== context) as db (db.name)}
                  <option value={db.name}>{db.name}</option>
                {/each}
              </select>
            {/if}
            {#if needsSchema}
              <input class={`${INPUT_SM_CLASS} w-32`} bind:value={grantSchema} placeholder={t("dbadmin.schema")} autocomplete="off" />
            {/if}
            {#if needsTable}
              <input class={`${INPUT_SM_CLASS} w-40`} bind:value={grantTable} placeholder={t("dbadmin.explorer.table")} autocomplete="off" />
            {/if}
          </div>
          <div class="flex flex-wrap gap-x-3 gap-y-1">
            {#each overview.privileges[grantScope] ?? [] as privilege (privilege)}
              <label class="inline-flex cursor-pointer items-center gap-1.5 text-xs">
                <input type="checkbox" class={CHECKBOX_CLASS} value={privilege} bind:group={grantPrivileges} />
                {privilege}
              </label>
            {/each}
          </div>
          <div class="flex items-center gap-3">
            <label class="inline-flex cursor-pointer items-center gap-1.5 text-xs text-text-secondary">
              <input type="checkbox" class={CHECKBOX_CLASS} bind:checked={grantOption} />
              {t("dbadmin.users.withGrantOption")}
            </label>
            <Button size="sm" variant="primary" disabled={grantPrivileges.length === 0} onclick={() => submitGrant(p)}>
              {t("dbadmin.users.previewGrant")}
            </Button>
          </div>
        </section>
      {/if}
    {/if}
  </div>
</div>

{#if pending}
  {@const current = pending}
  <StatementModal
    title={current.title}
    hint={t("dbadmin.users.statementHint")}
    danger={current.danger}
    confirmName={current.confirmName}
    run={(execute) => applyUserAction(connectionId, current.action, execute)}
    onClose={() => (pending = null)}
    onDone={done}
  />
{/if}
