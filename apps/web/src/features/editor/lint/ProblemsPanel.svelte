<script lang="ts">
  import { summarizeLint, type LintFinding, type LintSettings, type LintSeverity } from "@athanordb/dbml-engine";
  import Icon from "@/components/icons/Icon.svelte";
  import { CheckCircleIcon, TableIcon } from "@/components/icons/Icons";
  import Badge, { type BadgeTone } from "@/components/ui/Badge.svelte";
  import Button from "@/components/ui/Button.svelte";
  import EmptyState from "@/components/ui/EmptyState.svelte";
  import ErrorText from "@/components/ui/ErrorText.svelte";
  import SegmentedControl from "@/components/ui/SegmentedControl.svelte";
  import { useAsyncAction } from "@/hooks/asyncAction.svelte";
  import { useTranslation } from "@/i18n/i18n.svelte";
  import LintSettingsCard from "./LintSettingsCard.svelte";

  /**
   * "Problèmes": what the schema linter finds, table by table, with the
   * project's own rules. Each finding can be opened in the schema; the two
   * that need no decision can be fixed from here; an administrator can except
   * a table from a rule, and chooses the rules below the list.
   */
  let {
    findings,
    settings,
    canFix,
    canManage,
    onOpenTable,
    onFix,
    onSaveSettings,
  }: {
    findings: LintFinding[];
    settings: LintSettings;
    /** Whether this table may be changed by this user: `edit` on the project, and no lock that binds them. */
    canFix: (tableId: string) => boolean;
    /** Project administrators choose the rules and the exceptions. */
    canManage: boolean;
    onOpenTable: (tableName: string, fieldName?: string) => void;
    onFix: (finding: LintFinding) => void;
    onSaveSettings: (settings: LintSettings) => Promise<void>;
  } = $props();

  const { t } = useTranslation();
  type Filter = "all" | LintSeverity;
  let filter = $state<Filter>("all");

  const TONE: Record<LintSeverity, BadgeTone> = { error: "danger", warning: "warning", info: "muted" };
  const summary = $derived(summarizeLint(findings));
  const filterOptions = $derived<{ value: Filter; label: string }[]>([
    { value: "all", label: `${t("lint.filter.all")} · ${findings.length}` },
    { value: "error", label: `${t("lint.severity.error")} · ${summary.error}` },
    { value: "warning", label: `${t("lint.severity.warning")} · ${summary.warning}` },
    { value: "info", label: `${t("lint.severity.info")} · ${summary.info}` },
  ]);

  /** Tables in the order of their worst finding — the order `lintProject` returns. */
  const groups = $derived.by(() => {
    const byTable = new Map<string, { tableId: string; tableName: string; findings: LintFinding[] }>();
    for (const finding of findings) {
      if (filter !== "all" && finding.severity !== filter) continue;
      const group = byTable.get(finding.tableId);
      if (group) group.findings.push(finding);
      else byTable.set(finding.tableId, { tableId: finding.tableId, tableName: finding.tableName, findings: [finding] });
    }
    return [...byTable.values()];
  });

  const message = (finding: LintFinding) =>
    t(`lint.rule.${finding.ruleId}.message` as "lint.rule.pk-required.message", finding.params);
  const ruleTitle = (finding: LintFinding) => t(`lint.rule.${finding.ruleId}.title` as "lint.rule.pk-required.title");

  const save = useAsyncAction((next: LintSettings) => onSaveSettings(next));
  const ignore = (finding: LintFinding) =>
    save.run({
      ...settings,
      ignores: [
        ...settings.ignores,
        { ruleId: finding.ruleId, tableId: finding.tableId, tableName: finding.tableName },
      ],
    });
</script>

<div class="min-h-0 flex-1 overflow-y-auto bg-bg" data-testid="problems">
  <div class="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
    <div class="flex flex-wrap items-center gap-3">
      <h2 class="m-0 flex-1 text-heading font-semibold text-text">{t("lint.title")}</h2>
      <SegmentedControl size="sm" bind:value={filter} options={filterOptions} aria-label={t("lint.filter.label")} />
    </div>
    {#if settings.blockDeployment && summary.error > 0}
      <p class="m-0 rounded-md border border-danger bg-danger-light px-3 py-2 text-xs text-danger" role="status">
        {t("lint.blocksDeployment", { count: summary.error })}
      </p>
    {/if}

    {#if groups.length === 0}
      <EmptyState>
        <span class="inline-flex items-center gap-2">
          <Icon icon={CheckCircleIcon} size={14} />
          {findings.length === 0 ? t("lint.empty") : t("lint.emptyFilter")}
        </span>
      </EmptyState>
    {:else}
      <ul class="m-0 flex list-none flex-col gap-3 p-0" aria-label={t("lint.title")}>
        {#each groups as group (group.tableId)}
          <li class="rounded-md border border-border bg-surface" data-table={group.tableName}>
            <div class="flex items-center gap-2 border-b border-border px-3 py-2">
              <Icon icon={TableIcon} size={13} />
              <span class="flex-1 truncate font-mono text-body-sm font-semibold text-text">{group.tableName}</span>
              <Button size="xs" variant="ghost" onclick={() => onOpenTable(group.tableName)}>
                {t("lint.openInSchema")}
              </Button>
            </div>
            <ul class="m-0 list-none p-0">
              {#each group.findings as finding (`${finding.ruleId}:${finding.fieldId ?? ""}`)}
                <li
                  class="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 text-xs last:border-b-0"
                  data-rule={finding.ruleId}
                  data-severity={finding.severity}
                >
                  <Badge tone={TONE[finding.severity]}>{t(`lint.severity.${finding.severity}`)}</Badge>
                  <span class="min-w-0 flex-1">
                    <span class="text-text">{message(finding)}</span>
                    <span class="ml-1 text-text-muted">· {ruleTitle(finding)}</span>
                  </span>
                  {#if finding.fieldName}
                    <Button
                      size="xs"
                      variant="ghost"
                      onclick={() => onOpenTable(finding.tableName, finding.fieldName)}
                    >
                      {t("lint.showColumn")}
                    </Button>
                  {/if}
                  {#if finding.fixable && canFix(finding.tableId)}
                    <Button size="xs" variant="outline" onclick={() => onFix(finding)}>
                      {t(`lint.fix.${finding.ruleId}` as "lint.fix.pk-required")}
                    </Button>
                  {/if}
                  {#if canManage}
                    <Button size="xs" variant="ghost" disabled={save.pending} onclick={() => void ignore(finding)}>
                      {t("lint.ignore")}
                    </Button>
                  {/if}
                </li>
              {/each}
            </ul>
          </li>
        {/each}
      </ul>
    {/if}
    {#if save.error}<ErrorText>{save.error}</ErrorText>{/if}

    <LintSettingsCard {settings} {canManage} onSave={onSaveSettings} />
  </div>
</div>
