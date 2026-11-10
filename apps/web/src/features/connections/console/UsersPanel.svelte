<script lang="ts">
  import Input from "@/components/ui/Input.svelte";
  import type {
    DatabaseEngine,
    DbAccessLevel,
    DbGrant,
    DbGrantScope,
    DbPrincipal,
    DbPrincipalRef,
    DbUserAction,
  } from "@nebuladb/shared";
  import { dbAccessPresets, dbRoleInfo, type DbRoleLevel } from "@nebuladb/shared";
  import SegmentedControl from "@/components/ui/SegmentedControl.svelte";
  import RoleDescription from "./RoleDescription.svelte";
  import RolePicker from "./RolePicker.svelte";
  import Icon from "@/components/icons/Icon.svelte";
  import { CloseIcon, KeyIcon, PlusIcon, TrashIcon, UserIcon, UsersIcon } from "@/components/icons/Icons";
  import Badge from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import Select from "@/components/ui/Select.svelte";
  import { toast } from "@/components/ui/toast.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useAsyncResource } from "@/hooks/asyncResource.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { assignDbCredentials, fetchUserDbAccess, saveUserDbAccess } from "@/services/dbAccessApi";
  import { applyUserAction, fetchGrants, fetchPrincipals, type ConnectionOverview } from "@/services/dbAdminApi";
  import { fetchUsers } from "@/services/usersApi";
  import StatementModal from "./StatementModal.svelte";
  import { generatePassword } from "@/utils/password";

  /**
   * Accounts, roles and privileges of the target server, in one model for
   * every engine — the server maps it to each engine's own statements, and
   * `overview.capabilities` says which parts apply (a host for MySQL accounts,
   * a server/database level for SQL Server). Nothing here writes directly:
   * each button builds a `DbUserAction` and hands it to `StatementModal`.
   *
   * On a connection that asks each person for their own account, a new account
   * can be handed to an Nebula user as it is created: it becomes their account
   * on this database ("Mes comptes SQL"), with a password they change there.
   */
  let {
    connectionId,
    engine,
    overview,
    personalAccounts = false,
  }: {
    connectionId: string;
    engine: DatabaseEngine;
    overview: ConnectionOverview;
    /** The connection is used with each person's own account — the only case where an account belongs to someone. */
    personalAccounts?: boolean;
  } = $props();

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
  let pending = $state.raw<{ title: string; action: DbUserAction; danger?: boolean; warning?: string; confirmName?: string } | null>(null);

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
  const selected = $derived((principals.data ?? []).find((p) => keyOf(p) === selectedKey) ?? null);

  // ---- What the list shows ----
  // Accounts and roles are two lists: the server mixes them with its own
  // built-ins, which an administrator rarely wants to read through.
  let view = $state<"accounts" | "roles">("accounts");
  let showSystem = $state(false);
  const isPublic = (name: string) => name.toLowerCase() === "public";
  /** A built-in role is worth listing when it is one we can explain; the rest hide with the system. */
  const documentedRole = (p: DbPrincipal) => !p.system || Boolean(dbRoleInfo(engine, p.name));
  const shownInList = (p: DbPrincipal) => {
    if (showSystem) return true;
    if (p.kind === "role") return !isPublic(p.name) && documentedRole(p);
    return !p.system;
  };
  const groups = $derived.by(() => {
    const needle = filter.trim().toLowerCase();
    const kind = view === "accounts" ? "user" : "role";
    const items = (principals.data ?? []).filter((p) => p.kind === kind && shownInList(p) && p.name.toLowerCase().includes(needle));
    if (view === "accounts") return [{ label: "", items }];
    return [
      { label: t("dbadmin.users.customRoles"), items: items.filter((p) => !p.system) },
      { label: t("dbadmin.users.builtinRoles"), items: items.filter((p) => p.system) },
    ].filter((group) => group.items.length > 0);
  });
  const listEmpty = $derived(groups.every((group) => group.items.length === 0));

  // Roles an account can be put in: any role but the implicit `public`, built-ins only where explained.
  const roles = $derived(
    (principals.data ?? []).filter((p) => p.kind === "role" && !isPublic(p.name) && documentedRole(p)).map((p) => p.name),
  );
  const systemRoleNames = $derived(new Set((principals.data ?? []).filter((p) => p.kind === "role" && p.system).map((p) => p.name)));

  // ---- Access-level shortcut ----
  // Offered where the engine ships roles that mean "read" / "write" / "admin" and this server has them all.
  const presets = $derived.by(() => {
    const found = dbAccessPresets(engine, Boolean(principalDatabase));
    if (!found) return null;
    const have = new Map((principals.data ?? []).filter((p) => p.kind === "role").map((p) => [p.name.toLowerCase(), p.name]));
    const resolved: Partial<Record<Exclude<DbRoleLevel, "none">, string[]>> = {};
    for (const [level, names] of Object.entries(found) as [Exclude<DbRoleLevel, "none">, string[]][]) {
      const actual = names.map((name) => have.get(name.toLowerCase()));
      if (actual.every((name): name is string => Boolean(name))) resolved[level] = actual;
    }
    return Object.keys(resolved).length > 0 ? resolved : null;
  });
  const presetRoles = $derived(new Set(Object.values(presets ?? {}).flat()));
  function levelOf(p: DbPrincipal): DbRoleLevel | "custom" {
    const held = p.memberOf.filter((role) => presetRoles.has(role));
    if (held.length === 0) return "none";
    const same = (names: string[]) => names.length === held.length && names.every((name) => held.includes(name));
    for (const [level, names] of Object.entries(presets ?? {}) as [Exclude<DbRoleLevel, "none">, string[]][]) {
      if (same(names)) return level;
    }
    return "custom";
  }
  function applyLevel(p: DbPrincipal, level: DbRoleLevel) {
    const target = level === "none" ? [] : (presets?.[level] ?? []);
    const held = p.memberOf.filter((role) => presetRoles.has(role));
    const add = target.filter((role) => !held.includes(role));
    const remove = held.filter((role) => !target.includes(role));
    if (add.length === 0 && remove.length === 0) return;
    pending = {
      title: t("dbadmin.users.level.title", { name: p.name, level: t(`dbadmin.users.level.${level}`) }),
      danger: level === "admin",
      action: { type: "setRoles", principal: refOf(p), add, remove },
    };
  }

  // ---- Roles of the selected account / members of the selected role ----
  let pickingRole = $state(false);
  let memberToAdd = $state("");
  const highRiskRoles = (names: string[]) => names.filter((name) => dbRoleInfo(engine, name)?.risk === "high");
  function addRoleTo(p: DbPrincipal, role: string) {
    const risky = highRiskRoles([role]).length > 0;
    pending = {
      title: t("dbadmin.users.addRoleTitle", { role, name: p.name }),
      danger: risky,
      warning: risky ? t("dbadmin.users.highRiskWarning") : undefined,
      action: { type: "grantRole", principal: refOf(p), role },
    };
    pickingRole = false;
  }

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
  /** Roles the new account joins as it is created. */
  let newRoles = $state<string[]>([]);
  /** SQL Server database users are mapped to an existing login and carry no password of their own. */
  const createNeedsPassword = $derived(newKind === "user" && !principalDatabase);

  // ---- Hand the new account to an Nebula user ----
  const NOBODY = "";
  const nebulaUsers = useAsyncResource(() => (personalAccounts ? fetchUsers() : Promise.resolve([])));
  let associateWith = $state(NOBODY);
  let associateLevel = $state<DbAccessLevel>("read");
  const canAssociate = $derived(personalAccounts && createNeedsPassword);
  const associateTarget = $derived(
    canAssociate ? ((nebulaUsers.data ?? []).find((user) => user.id === associateWith) ?? null) : null,
  );

  /**
   * After the account exists: the person is given access to this database if
   * they have none (an instance administrator needs none), then the account is
   * kept as theirs — the server signs in with it once before keeping it.
   */
  const associate = useAsyncAction(
    async (target: { id: string; displayName: string; isAdmin: boolean }, name: string, password: string) => {
      if (!target.isAdmin) {
        const access = await fetchUserDbAccess(target.id);
        const own = access.grants.find((grant) => grant.connectionId === connectionId);
        const hasAccess = Boolean(own?.level) || access.inherited.some((entry) => entry.connectionId === connectionId);
        if (!hasAccess) {
          await saveUserDbAccess(target.id, [
            ...access.grants
              .filter((grant) => grant.connectionId !== connectionId)
              .map((grant) => ({ connectionId: grant.connectionId, level: grant.level, sqlUsername: grant.sqlUsername })),
            { connectionId, level: associateLevel, sqlUsername: name },
          ]);
        }
      }
      await assignDbCredentials(target.id, connectionId, name, password);
      toast.success(t("dbadmin.users.associated", { account: name, user: target.displayName }));
    },
  );

  function submitCreate() {
    pending = {
      title: t("dbadmin.users.createTitle"),
      action: {
        type: "create",
        principal: { name: newName.trim(), host: capabilities.principalHost && newKind === "user" ? newHost.trim() || "%" : undefined, kind: newKind, database: principalDatabase },
        password: createNeedsPassword ? newPassword : undefined,
        roles: newRoles.length > 0 ? newRoles : undefined,
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

  function describeGrant(grant: DbGrant): string {
    if (grant.scope === "server") return t("dbadmin.users.scope.server");
    return [grant.database, grant.schema, grant.table ?? (grant.scope === "table" ? "*" : undefined)].filter(Boolean).join(".");
  }

  function done() {
    // A dropped principal must not stay selected: its grants can no longer be read.
    if (pending?.action.type === "drop") selectedKey = null;
    if (pending?.action.type === "create" && associateTarget && pending.action.password) {
      void associate.run(associateTarget, pending.action.principal.name, pending.action.password);
    }
    associateWith = NOBODY;
    pending = null;
    creating = false;
    changingPassword = false;
    passwordValue = "";
    newName = "";
    newPassword = "";
    newRoles = [];
    principals.reload();
    grants.reload();
  }

  const readOnlyTip = $derived(overview.readOnly ? t("dbadmin.readOnlyConnection") : undefined);
  /** PostgreSQL has no lock flag: "locking" a role is taking LOGIN away, so it applies to roles too. */
  const canToggleLogin = (p: DbPrincipal) => !principalDatabase && (p.kind === "user" || engine === "postgres");
</script>

<div class="grid grid-cols-1 gap-4 md:grid-cols-12">
  <div class="space-y-2 md:col-span-4">
    <SegmentedControl
      size="sm"
      class="w-full"
      bind:value={view}
      onChange={() => {
        selectedKey = null;
        pickingRole = false;
      }}
      options={[
        { value: "accounts", label: t("dbadmin.users.view.accounts"), icon: UserIcon },
        { value: "roles", label: t("dbadmin.users.view.roles"), icon: UsersIcon },
      ]}
      aria-label={t("dbadmin.users.kindLabel")}
    />
    {#if hasDatabaseContext}
      <Select
        size="sm"
        class="w-full"
        bind:value={context}
        options={[
          ...(capabilities.principalLevels ? [{ value: SERVER_LEVEL, label: t("dbadmin.users.serverLevel") }] : []),
          ...overview.databases.map((db) => ({ value: db.name, label: db.name })),
        ]}
        aria-label={t("dbadmin.users.level")}
      />
    {/if}
    <div class="flex items-center gap-1">
      <Input inputSize="sm" class="min-w-0 flex-1" bind:value={filter} placeholder={t("dbadmin.users.filter")} />
      <Button size="sm" variant="primary" disabled={overview.readOnly} data-tooltip={readOnlyTip} onclick={() => {
        creating = !creating;
        newKind = view === "roles" ? "role" : "user";
      }}>
        <Icon icon={PlusIcon} size={12} />
        {t("common.add")}
      </Button>
    </div>

    {#if creating}
      <div class="space-y-2 rounded-md border border-border bg-surface-raised p-2.5">
        <Select
          size="sm"
          class="w-full"
          bind:value={newKind}
          options={[
            { value: "user", label: t("dbadmin.users.kind.user") },
            { value: "role", label: t("dbadmin.users.kind.role") },
          ]}
          aria-label={t("dbadmin.users.kindLabel")}
        />
        <Input inputSize="sm" class="w-full" bind:value={newName} placeholder={t("common.name")} autocomplete="off" />
        {#if capabilities.principalHost && newKind === "user"}
          <Input inputSize="sm" class="w-full" bind:value={newHost} placeholder={t("dbadmin.users.host")} autocomplete="off" />
        {/if}
        {#if createNeedsPassword}
          <div class="flex items-center gap-1">
            <Input inputSize="sm" class="min-w-0 flex-1 font-mono" bind:value={newPassword} placeholder={t("connections.password")} autocomplete="off" />
            <Button size="sm" variant="ghost" onclick={() => (newPassword = generatePassword())}>{t("dbadmin.users.generate")}</Button>
          </div>
          <Hint>{t("dbadmin.users.passwordOnce")}</Hint>
          {#if canAssociate}
            <Select
              size="sm"
              class="w-full"
              bind:value={associateWith}
              options={[
                { value: NOBODY, label: t("dbadmin.users.associateNobody") },
                ...(nebulaUsers.data ?? [])
                  .filter((user) => !user.disabledAt)
                  .map((user) => ({ value: user.id, label: user.displayName, hint: user.email })),
              ]}
              aria-label={t("dbadmin.users.associateLabel")}
            />
            {#if associateTarget && !associateTarget.isAdmin}
              <Select
                size="sm"
                class="w-full"
                bind:value={associateLevel}
                options={[
                  { value: "read", label: t("dbAccess.level.read") },
                  { value: "write", label: t("dbAccess.level.write") },
                ]}
                aria-label={t("dbadmin.users.associateLevel")}
              />
            {/if}
            {#if associateTarget}<Hint>{t("dbadmin.users.associateHint")}</Hint>{/if}
          {/if}
        {:else if newKind === "user"}
          <Hint>{t("dbadmin.users.mappedToLogin")}</Hint>
        {/if}
        {#if roles.length > 0}
          <div class="space-y-1">
            <div class="text-xs font-semibold text-text-secondary">{t("dbadmin.users.createRoles")}</div>
            <div class="flex max-h-32 flex-col gap-1 overflow-y-auto">
              {#each roles as role (role)}
                <Checkbox
                  checked={newRoles.includes(role)}
                  onChange={(checked) => (newRoles = checked ? [...newRoles, role] : newRoles.filter((held) => held !== role))}
                >
                  <span class="text-xs">{role}</span>
                </Checkbox>
              {/each}
            </div>
          </div>
        {/if}
        <Button size="sm" variant="primary" disabled={!newName.trim() || (createNeedsPassword && !newPassword)} onclick={submitCreate}>
          {t("dbadmin.users.previewCreate")}
        </Button>
      </div>
    {/if}

    {#if nebulaUsers.error}<ErrorText>{nebulaUsers.error}</ErrorText>{/if}
    {#if associate.error}
      <ErrorText>{t("dbadmin.users.associateFailed", { reason: associate.error })}</ErrorText>
    {/if}
    {#if principals.error}<ErrorText>{principals.error}</ErrorText>{/if}
    <Checkbox bind:checked={showSystem}>
      <span class="text-xs text-text-secondary">{t("dbadmin.users.showSystem")}</span>
    </Checkbox>
    <div class="max-h-[460px] space-y-0.5 overflow-y-auto">
      {#each groups as group (group.label)}
      {#if group.label}
        <div class="px-2 pt-2 pb-0.5 text-micro font-bold tracking-wider text-text-muted uppercase">{group.label}</div>
      {/if}
      {#each group.items as p (keyOf(p))}
        {@const active = keyOf(p) === selectedKey}
        <button
          type="button"
          onclick={() => {
            selectedKey = keyOf(p);
            pickingRole = false;
            changingPassword = false;
          }}
          class={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors ${
            active ? "bg-primary/15 font-semibold text-primary" : "text-text hover:bg-surface-hover"
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
      {/each}
      {#if listEmpty}
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
        <span class="font-mono text-body font-semibold">{p.name}{p.host ? `@${p.host}` : ""}</span>
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
          <Input inputSize="sm" class="min-w-0 flex-1 font-mono" bind:value={passwordValue} placeholder={t("dbadmin.users.newPassword")} autocomplete="off" />
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

      {#if p.kind === "role"}
        <div class="rounded-md border border-border bg-surface-raised p-2.5">
          <div class="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">{t("dbadmin.users.roleGives")}</div>
          <RoleDescription {engine} role={p.name} system={p.system} />
        </div>
      {:else}
        {@const held = p.memberOf.filter((role) => !isPublic(role))}
        {@const risky = highRiskRoles(held)}
        <div class="space-y-1 rounded-md border border-border bg-surface-raised p-2.5 text-xs">
          <p class="text-text-secondary">
            {held.length === 0
              ? t("dbadmin.users.summary.none", { name: p.name })
              : t("dbadmin.users.summary.roles", { name: p.name, roles: held.join(", ") })}
          </p>
          {#if risky.length > 0}
            <p class="font-semibold text-danger">{t("dbadmin.users.summary.highRisk", { roles: risky.join(", ") })}</p>
          {/if}
        </div>

        {#if presets}
          {@const level = levelOf(p)}
          <section class="space-y-1">
            <div class="text-xs font-semibold uppercase tracking-wider text-text-muted">{t("dbadmin.users.level.label")}</div>
            <SegmentedControl
              size="sm"
              value={level as string}
              onChange={(next) => applyLevel(p, next as DbRoleLevel)}
              options={[
                { value: "none", label: t("dbadmin.users.level.none"), disabled: locked },
                ...(presets.read ? [{ value: "read", label: t("dbadmin.users.level.read"), disabled: locked }] : []),
                ...(presets.write ? [{ value: "write", label: t("dbadmin.users.level.write"), disabled: locked }] : []),
                ...(presets.admin ? [{ value: "admin", label: t("dbadmin.users.level.admin"), disabled: locked }] : []),
                ...(level === "custom" ? [{ value: "custom", label: t("dbadmin.users.level.custom"), disabled: true }] : []),
              ]}
              aria-label={t("dbadmin.users.level.label")}
            />
            <Hint>{t("dbadmin.users.level.hint", { roles: [...presetRoles].join(", ") })}</Hint>
          </section>
        {/if}

        <section>
          <div class="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">{t("dbadmin.users.roles")}</div>
          <div class="space-y-1">
            {#each held as role (role)}
              <div class="flex items-start gap-2 rounded-md border border-border px-2 py-1.5">
                <div class="min-w-0 flex-1">
                  <div class="font-mono text-xs font-semibold">{role}</div>
                  <RoleDescription {engine} {role} system={systemRoleNames.has(role)} />
                </div>
                <Button
                  variant="danger-ghost"
                  size="icon-xs"
                  disabled={locked}
                  data-tooltip={lockedTip ?? t("dbadmin.users.removeRole", { role })}
                  aria-label={t("dbadmin.users.removeRole", { role })}
                  onclick={() =>
                    (pending = {
                      title: t("dbadmin.users.removeRole", { role }),
                      danger: true,
                      action: { type: "revokeRole", principal: refOf(p), role },
                    })}
                >
                  <Icon icon={CloseIcon} size={11} />
                </Button>
              </div>
            {/each}
            {#if held.length === 0}<span class="text-xs text-text-muted">{t("dbadmin.users.noRoles")}</span>{/if}
          </div>
          {#if !locked && roles.some((r) => r !== p.name && !p.memberOf.includes(r))}
            <Button size="xs" variant="ghost" class="mt-1.5" onclick={() => (pickingRole = !pickingRole)}>
              <Icon icon={PlusIcon} size={12} />
              {t("dbadmin.users.addRole")}
            </Button>
            {#if pickingRole}
              <div class="mt-1.5">
                <RolePicker
                  {engine}
                  roles={roles.filter((r) => r !== p.name && !p.memberOf.includes(r))}
                  systemRoles={systemRoleNames}
                  onPick={(role) => addRoleTo(p, role)}
                />
              </div>
            {/if}
          {/if}
        </section>
      {/if}

      {#if p.kind === "role"}
        {@const members = (principals.data ?? []).filter((m) => m.memberOf.includes(p.name))}
        {@const candidates = (principals.data ?? []).filter((m) => m.kind === "user" && !m.system && !m.memberOf.includes(p.name))}
        <section>
          <div class="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
            {t("dbadmin.users.members")} ({members.length})
          </div>
          <div class="space-y-1">
            {#each members as m (keyOf(m))}
              <div class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
                <Icon icon={m.kind === "role" ? UsersIcon : UserIcon} size={12} class="shrink-0 text-text-muted" />
                <span class="min-w-0 flex-1 truncate font-mono">{m.name}{m.host ? `@${m.host}` : ""}</span>
                {#if m.system}<Badge tone="muted">{t("dbadmin.users.system")}</Badge>{/if}
                <Button
                  variant="danger-ghost"
                  size="icon-xs"
                  disabled={overview.readOnly || m.system}
                  data-tooltip={readOnlyTip ?? (m.system ? t("dbadmin.systemObject") : t("dbadmin.users.removeRole", { role: p.name }))}
                  aria-label={t("dbadmin.users.removeRole", { role: p.name })}
                  onclick={() =>
                    (pending = {
                      title: t("dbadmin.users.removeRole", { role: p.name }),
                      danger: true,
                      action: { type: "revokeRole", principal: refOf(m), role: p.name },
                    })}
                >
                  <Icon icon={CloseIcon} size={11} />
                </Button>
              </div>
            {/each}
            {#if members.length === 0}<span class="text-xs text-text-muted">{t("dbadmin.users.noMembers")}</span>{/if}
          </div>
          {#if !overview.readOnly && candidates.length > 0}
            <div class="mt-1.5 flex items-center gap-1.5">
              <Select
                size="sm"
                class="min-w-48"
                bind:value={memberToAdd}
                options={candidates.map((m) => ({ value: keyOf(m), label: m.host ? `${m.name}@${m.host}` : m.name }))}
                placeholder={t("dbadmin.users.addMember")}
                aria-label={t("dbadmin.users.addMember")}
              />
              {#if memberToAdd}
                <Button
                  size="xs"
                  variant="primary"
                  onclick={() => {
                    const target = candidates.find((m) => keyOf(m) === memberToAdd);
                    memberToAdd = "";
                    if (target) addRoleTo(target, p.name);
                  }}
                >
                  {t("common.add")}
                </Button>
              {/if}
            </div>
          {/if}
        </section>
      {/if}

      {#key keyOf(p)}
      <details class="rounded-md border border-border p-2.5" open={p.kind === "role" || !presets}>
        <summary class="cursor-pointer text-xs font-semibold text-text-secondary">{t("dbadmin.users.advanced")}</summary>
        <div class="mt-2 space-y-4">

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
            <Select
              size="sm"
              class="w-28"
              bind:value={grantScope}
              options={scopes.map((scope) => ({ value: scope, label: t(`dbadmin.users.scope.${scope}`) }))}
              aria-label={t("dbadmin.users.scopeLabel")}
            />
            {#if needsDatabase}
              <Select
                size="sm"
                class="min-w-40"
                bind:value={grantDatabase}
                options={[
                  { value: "", label: context || t("dbadmin.database") },
                  ...overview.databases.filter((d) => d.name !== context).map((db) => ({ value: db.name, label: db.name })),
                ]}
                aria-label={t("dbadmin.database")}
              />
            {/if}
            {#if needsSchema}
              <Input inputSize="sm" class="w-32" bind:value={grantSchema} placeholder={t("dbadmin.schema")} autocomplete="off" />
            {/if}
            {#if needsTable}
              <Input inputSize="sm" class="w-40" bind:value={grantTable} placeholder={t("dbadmin.explorer.table")} autocomplete="off" />
            {/if}
          </div>
          <div class="flex flex-wrap gap-x-3 gap-y-1">
            {#each overview.privileges[grantScope] ?? [] as privilege (privilege)}
              <Checkbox
                checked={grantPrivileges.includes(privilege)}
                onChange={(checked) =>
                  (grantPrivileges = checked ? [...grantPrivileges, privilege] : grantPrivileges.filter((held) => held !== privilege))}
              >
                <span class="text-xs">{privilege}</span>
              </Checkbox>
            {/each}
          </div>
          <div class="flex items-center gap-3">
            <Checkbox bind:checked={grantOption}>
              <span class="text-xs text-text-secondary">{t("dbadmin.users.withGrantOption")}</span>
            </Checkbox>
            <Button size="sm" variant="primary" disabled={grantPrivileges.length === 0} onclick={() => submitGrant(p)}>
              {t("dbadmin.users.previewGrant")}
            </Button>
          </div>
        </section>
      {/if}
        </div>
      </details>
      {/key}
    {/if}
  </div>
</div>

{#if pending}
  {@const current = pending}
  <StatementModal
    title={current.title}
    hint={current.warning ? `${current.warning} ${t("dbadmin.users.statementHint")}` : t("dbadmin.users.statementHint")}
    danger={current.danger}
    confirmName={current.confirmName}
    run={(execute) => applyUserAction(connectionId, current.action, execute)}
    onClose={() => (pending = null)}
    onDone={done}
  />
{/if}
