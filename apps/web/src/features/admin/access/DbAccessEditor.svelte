<script lang="ts" module>
  import type {
    DatabaseEngine,
    DbAccessGrant,
    DbAccessGrantInput,
    DbAccessLevel,
    InheritedDbAccess,
  } from "@nebuladb/shared";

  /** One connection's line in the editor: the level granted, and the database account name proposed. */
  export interface DbAccessDraftLine {
    level: DbAccessLevel | null;
    sqlUsername: string;
    /** Invitations: create that account on the database once the invitation is accepted. */
    createAccount?: boolean;
  }
  export type DbAccessDraft = Record<string, DbAccessDraftLine>;

  /** The editor's starting point from what the server holds. */
  export function draftFromGrants(grants: readonly DbAccessGrant[]): DbAccessDraft {
    const draft: DbAccessDraft = {};
    for (const grant of grants) draft[grant.connectionId] = { level: grant.level, sqlUsername: grant.sqlUsername ?? "" };
    return draft;
  }

  /** What the server is sent: only the lines that grant something or name an account. */
  export function grantsFromDraft(draft: DbAccessDraft, withAccounts: boolean, withCreate = false): DbAccessGrantInput[] {
    return Object.entries(draft).flatMap(([connectionId, line]) => {
      const sqlUsername = withAccounts ? line.sqlUsername.trim() : "";
      if (!line.level && !sqlUsername) return [];
      return [
        {
          connectionId,
          level: line.level,
          ...(withAccounts ? { sqlUsername: sqlUsername || null } : {}),
          ...(withCreate && sqlUsername && line.createAccount ? { createAccount: true } : {}),
        },
      ];
    });
  }
</script>

<script lang="ts">
  import { DatabaseIcon } from "@/components/icons/Icons";
  import Icon from "@/components/icons/Icon.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import Checkbox from "@/components/ui/Checkbox.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import Input from "@/components/ui/Input.svelte";
  import Select from "@/components/ui/Select.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";

  type LevelChoice = "none" | DbAccessLevel;

  /**
   * Which databases someone may query, and with what: one line per instance
   * connection, a level (none / read / write) and — for a person, not a
   * team — the account name on that database to propose to them. Never a
   * password: the person types their own in "Mon compte SQL".
   */
  let {
    connections,
    value = $bindable(),
    withAccounts,
    withCreate = false,
    inherited = [],
    disabled = false,
  }: {
    connections: readonly { id: string; name: string; engine: DatabaseEngine; authMode?: string; readOnly?: boolean }[];
    value: DbAccessDraft;
    /** Users and invitations carry an account name per database; a team does not. */
    withAccounts: boolean;
    /** Invitations: offer to create the account on a personal-account database, instead of only proposing its name. */
    withCreate?: boolean;
    /** What the person already holds through a team — shown, not editable here. */
    inherited?: readonly InheritedDbAccess[];
    disabled?: boolean;
  } = $props();

  const { t } = useTranslation();
  const options = $derived<{ value: LevelChoice; label: string }[]>([
    { value: "none", label: t("dbAccess.level.none") },
    { value: "read", label: t("dbAccess.level.read") },
    { value: "write", label: t("dbAccess.level.write") },
  ]);

  function choiceOf(level: DbAccessLevel | null): LevelChoice {
    return level ?? "none";
  }

  function line(id: string): DbAccessDraftLine {
    return value[id] ?? { level: null, sqlUsername: "" };
  }

  function setLevel(id: string, choice: LevelChoice) {
    value[id] = { ...line(id), level: choice === "none" ? null : choice };
  }

  function setAccount(id: string, sqlUsername: string) {
    value[id] = { ...line(id), sqlUsername };
  }

  function setCreate(id: string, createAccount: boolean) {
    value[id] = { ...line(id), createAccount };
  }
</script>

{#if connections.length === 0}
  <EmptyState>{t("dbAccess.noConnections")}</EmptyState>
{:else}
  <div class="flex flex-col gap-1.5" data-testid="db-access-editor">
    <Hint>{withAccounts ? t("dbAccess.hintUser") : t("dbAccess.hintTeam")}</Hint>
    {#each connections as connection (connection.id)}
      {@const current = line(connection.id)}
      {@const viaTeams = inherited.filter((entry) => entry.connectionId === connection.id)}
      <div class="flex flex-wrap items-center gap-2 rounded-sm px-1 py-1 hover:bg-surface-hover" data-connection={connection.name}>
        <Icon icon={DatabaseIcon} size={13} class="text-text-muted" />
        <span class="min-w-32 flex-1 truncate text-body-sm text-text">
          {connection.name}
          <span class="text-label text-text-muted">· {t(`connections.engine.${connection.engine}`)}</span>
        </span>
        {#each viaTeams as entry (entry.teamId)}
          <span class="text-label text-text-muted">
            {t("dbAccess.inherited", { team: entry.teamName, level: t(`dbAccess.level.${entry.level}`) })}
          </span>
        {/each}
        <Select
          size="sm"
          class="w-36"
          value={choiceOf(current.level)}
          {options}
          {disabled}
          onChange={(choice) => setLevel(connection.id, choice)}
          aria-label={t("dbAccess.levelFor", { connection: connection.name })}
        />
        {#if withAccounts}
          <Input
            inputSize="sm"
            wrapperClassName="w-40"
            value={current.sqlUsername}
            oninput={(event: Event) => setAccount(connection.id, (event.currentTarget as HTMLInputElement).value)}
            placeholder={t("dbAccess.accountPlaceholder")}
            aria-label={t("dbAccess.accountFor", { connection: connection.name })}
            autocomplete="off"
            {disabled}
          />
          {#if withCreate && connection.authMode === "personal" && !connection.readOnly && current.sqlUsername.trim()}
            <Checkbox
              checked={current.createAccount ?? false}
              onChange={(checked) => setCreate(connection.id, checked)}
              {disabled}
            >
              {t("dbAccess.createAccount")}
            </Checkbox>
          {/if}
        {/if}
      </div>
    {/each}
  </div>
{/if}
