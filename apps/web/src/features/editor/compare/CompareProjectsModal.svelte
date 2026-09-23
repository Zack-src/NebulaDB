<script lang="ts" module>
  import type { MigrationChangeStatus, MigrationDialect, MigrationFieldChange } from "@athanordb/dbml-engine";

  const SIGN: Record<MigrationChangeStatus, string> = { added: "+", dropped: "-", modified: "~" };
  const TONE: Record<MigrationChangeStatus, string> = {
    added: "text-success",
    dropped: "text-danger",
    modified: "text-warning",
  };
  const DIALECTS: { id: MigrationDialect; label: string }[] = [
    { id: "postgres", label: "PostgreSQL" },
    { id: "mysql", label: "MySQL" },
    { id: "mssql", label: "SQL Server" },
    { id: "oracle", label: "Oracle" },
    { id: "sqlite", label: "SQLite" },
  ];

  /** "varchar(100) → text, → NOT NULL" — the concrete part of a modified column. */
  function describeFieldChange(change: MigrationFieldChange): string {
    const before = change.before;
    const after = change.after;
    if (!before || !after) return "";
    const parts: string[] = [];
    if (change.typeChanged) parts.push(`${before.type} → ${after.type}`);
    if (change.notNullChanged) parts.push(after.notNull ? "→ NOT NULL" : "→ NULL");
    if (change.defaultChanged) parts.push(`default ${before.default ?? "∅"} → ${after.default ?? "∅"}`);
    if (change.pkChanged) parts.push(after.pk ? "+pk" : "-pk");
    if (change.uniqueChanged) parts.push(after.unique ? "+unique" : "-unique");
    return parts.join(", ");
  }
</script>

<script lang="ts">
  import type { Project } from "@athanordb/shared";
  import { diffTargetAgainstLive, generateMigrationSql } from "@athanordb/dbml-engine";
  import Icon from "@/components/icons/Icon.svelte";
  import { SwapHorizontalIcon } from "@/components/icons/Icons";
  import Modal from "@/components/overlays/Modal.svelte";
  import Button from "@/components/ui/Button.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import Hint from "@/components/ui/Hint.svelte";
  import Tabs from "@/components/ui/Tabs.svelte";
  import { SELECT_CLASS, SELECT_SM_CLASS, TEXTAREA_CODE_CLASS } from "@/components/ui/inputStyles";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import { describeApiError } from "@/i18n/serverErrorMessages";
  import { fetchProjectContent, fetchProjects } from "@/services/projectsApi";
  import type { ProjectSummary } from "@/types";
  import { copyText } from "@/utils/clipboard";

  /**
   * Compares the open project with another one the user can see. Matching is
   * by table/column *name* (`diffTargetAgainstLive`, the same engine as the
   * live-database drift check): ids are per-project and never line up across
   * two projects, so the id-based history diff would call every table
   * "removed + added". The same diff feeds the migration generator, so the
   * SQL tab answers "what turns one schema into the other".
   */
  let { currentProject, onClose }: { currentProject: Project; onClose: () => void } = $props();

  const { t } = useTranslation();
  type View = "summary" | "sql";

  let candidates = $state.raw<ProjectSummary[]>([]);
  let otherId = $state("");
  let other = $state.raw<Project | null>(null);
  let loadingOther = $state(false);
  let error = $state<string | null>(null);
  /** true: the open project is the target (the other one is migrated towards it); false: the reverse. */
  let currentIsTarget = $state(true);
  let view = $state<View>("summary");
  let dialect = $state<MigrationDialect>("postgres");
  let copied = $state(false);

  $effect(() => {
    fetchProjects()
      .then((list) => {
        candidates = list.filter((p) => p.id !== currentProject.id && p.status !== "trashed");
      })
      .catch((err: unknown) => (error = describeApiError(err, t)));
  });

  $effect(() => {
    const id = otherId;
    other = null;
    if (!id) return;
    let cancelled = false;
    loadingOther = true;
    error = null;
    fetchProjectContent(id)
      .then((project) => {
        if (!cancelled) other = project;
      })
      .catch((err: unknown) => {
        if (!cancelled) error = describeApiError(err, t);
      })
      .finally(() => {
        if (!cancelled) loadingOther = false;
      });
    return () => {
      cancelled = true;
    };
  });

  const from = $derived(other ? (currentIsTarget ? other : currentProject) : null);
  const to = $derived(other ? (currentIsTarget ? currentProject : other) : null);
  const diff = $derived(from && to ? diffTargetAgainstLive(from, to) : null);
  const sql = $derived(diff && view === "sql" ? generateMigrationSql(diff, dialect) : "");
  const counts = $derived.by(() => {
    const byStatus = { added: 0, dropped: 0, modified: 0 };
    for (const table of diff?.tables ?? []) byStatus[table.status]++;
    return byStatus;
  });

  function copySql() {
    void copyText(sql).then((ok) => {
      if (!ok) return;
      copied = true;
      setTimeout(() => (copied = false), 1500);
    });
  }
</script>

<Modal title={t("compare.title")} wide {onClose}>
  <Hint>{t("compare.hint")}</Hint>

  <div class="mt-3 flex flex-wrap items-center gap-2">
    <span class="rounded bg-surface-hover px-2 py-1 text-xs font-semibold" data-testid="compare-from">
      {from ? from.name : currentIsTarget ? "…" : currentProject.name}
    </span>
    <Button
      size="icon-sm"
      variant="ghost"
      onclick={() => (currentIsTarget = !currentIsTarget)}
      data-tooltip={t("compare.swap")}
      aria-label={t("compare.swap")}
    >
      <Icon icon={SwapHorizontalIcon} size={14} />
    </Button>
    <span class="rounded bg-surface-hover px-2 py-1 text-xs font-semibold" data-testid="compare-to">
      {to ? to.name : currentIsTarget ? currentProject.name : "…"}
    </span>
    <select
      class={`${SELECT_CLASS} ml-auto min-w-[200px]`}
      bind:value={otherId}
      aria-label={t("compare.pickProject")}
      data-testid="compare-picker"
    >
      <option value="">{t("compare.pickProject")}</option>
      {#each candidates as candidate (candidate.id)}
        <option value={candidate.id}>{candidate.name}</option>
      {/each}
    </select>
  </div>

  {#if error}<ErrorText>{error}</ErrorText>{/if}

  {#if loadingOther}
    <p class="mt-4 text-xs text-text-muted">{t("common.loading")}</p>
  {:else if diff}
    <div class="mt-4 flex items-center justify-between gap-3">
      <Tabs
        variant="line"
        tabs={[
          { id: "summary", label: t("compare.tab.summary") },
          { id: "sql", label: t("compare.tab.sql") },
        ]}
        activeTab={view}
        onChange={(next) => (view = next as View)}
      />
      {#if view === "sql"}
        <div class="flex items-center gap-2">
          <select class={SELECT_SM_CLASS} bind:value={dialect} aria-label={t("compare.dialect")}>
            {#each DIALECTS as option (option.id)}
              <option value={option.id}>{option.label}</option>
            {/each}
          </select>
          <Button size="sm" onclick={copySql} disabled={!diff.hasChanges}>
            {copied ? t("common.copied") : t("compare.copySql")}
          </Button>
        </div>
      {/if}
    </div>

    {#if view === "summary"}
      {#if !diff.hasChanges}
        <p class="mt-3 text-xs text-text-muted" data-testid="compare-identical">{t("compare.identical")}</p>
      {:else}
        <p class="mt-3 text-xs text-text-muted" data-testid="compare-counts">
          {t("compare.counts", { added: counts.added, dropped: counts.dropped, modified: counts.modified })}
        </p>
        <div class="mt-2 max-h-[46vh] overflow-y-auto rounded-md border border-border p-2" data-testid="compare-diff">
          {#each diff.tables as table (table.name)}
            <div class={`font-mono text-xs leading-relaxed ${TONE[table.status]}`}>
              {`${SIGN[table.status]} Table ${table.name}`}
            </div>
            {#if table.status === "modified"}
              {#each table.fields as field (field.name)}
                <div class={`pl-5 font-mono text-[11.5px] leading-relaxed ${TONE[field.status]}`}>
                  {SIGN[field.status]}
                  {field.name}
                  {#if field.status === "modified"}<span class="text-text-muted">— {describeFieldChange(field)}</span
                    >{/if}
                </div>
              {/each}
              {#each table.addedIndexes as index, i (i)}
                <div class="pl-5 font-mono text-[11.5px] text-success">{`+ index ${index.name ?? ""}`}</div>
              {/each}
              {#each table.droppedIndexes as index, i (i)}
                <div class="pl-5 font-mono text-[11.5px] text-danger">{`- index ${index.name ?? ""}`}</div>
              {/each}
            {/if}
          {/each}
          {#each diff.refs as ref, i (i)}
            <div class={`font-mono text-xs leading-relaxed ${TONE[ref.status]}`}>
              {`${SIGN[ref.status]} Ref ${ref.fromTable}.${ref.fromField} → ${ref.toTable}.${ref.toField}`}
            </div>
          {/each}
        </div>
      {/if}
    {:else}
      <textarea
        class={`${TEXTAREA_CODE_CLASS} mt-3 h-[46vh] w-full`}
        readonly
        value={sql}
        aria-label={t("compare.tab.sql")}
        data-testid="compare-sql"
      ></textarea>
      <Hint>{t("compare.sqlHint")}</Hint>
    {/if}
  {/if}
</Modal>
