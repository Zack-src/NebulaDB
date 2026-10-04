import type * as Y from "yjs";
import {
  applyLintFix,
  lintProject,
  validateProject,
  type LintFinding,
  type LintSettings,
  type ValidationIssue,
} from "@athanordb/dbml-engine";
import { getTablesMap, type Project } from "@athanordb/shared";
import { toast } from "@/components/ui/toast.svelte";
import type { SchemaFinding } from "@/features/editor/dbml/lint";
import { i18n } from "@/i18n/i18n.svelte";
import { generateId } from "@/utils/id";

const NO_FROZEN_TABLES: ReadonlySet<string> = new Set();
/** One "this table is locked" message per burst of keystrokes, not one per key. */
const LOCKED_EDIT_TOAST_GAP_MS = 3000;

interface SchemaQualityInput {
  project: () => Project | null;
  /** Null for a read-only grant — every write below then does nothing. */
  writeDoc: () => Y.Doc | null;
  canWrite: () => boolean;
  settings: () => LintSettings;
  /** Ids of the tables a lock forbids this user to alter. */
  frozenTableIds: () => ReadonlySet<string>;
}

function groupBy(issues: ValidationIssue[], key: "tableId" | "refId"): Map<string, ValidationIssue[]> {
  const map = new Map<string, ValidationIssue[]>();
  for (const issue of issues) {
    const id = issue[key];
    if (!id) continue;
    const list = map.get(id);
    if (list) list.push(issue);
    else map.set(id, [issue]);
  }
  return map;
}

/**
 * What the editor knows about the quality of the live schema, and the few
 * writes that follow from it: the linter's findings (for the problems tab,
 * the canvas badges and the DBML underlines), the structural issues, the
 * tables a lock freezes, the two safe fixes, and the notes the data
 * dictionary edits.
 *
 * Recomputed on every document update — a handful of O(tables + refs) passes,
 * cheap next to the Yjs → Project rebuild that already happens on each change.
 */
export class SchemaQuality {
  constructor(private readonly input: SchemaQualityInput) {}

  private message = (finding: LintFinding) =>
    i18n.t(`lint.rule.${finding.ruleId}.message` as "lint.rule.pk-required.message", finding.params);

  readonly findings = $derived.by((): LintFinding[] => {
    const project = this.input.project();
    return project ? lintProject(project, this.input.settings()) : [];
  });

  /**
   * What the canvas marks on a table: what is structurally wrong, plus the
   * linter's errors and warnings (its `info` findings stay in the problems
   * tab). The missing key is the linter's to report, at the project's level.
   */
  private readonly issues = $derived.by((): ValidationIssue[] => {
    const project = this.input.project();
    if (!project) return [];
    const structural = validateProject(project).filter((issue) => issue.code !== "no-primary-key");
    const conventions = this.findings
      .filter((finding) => finding.severity !== "info")
      .map((finding) => ({
        severity: finding.severity as ValidationIssue["severity"],
        message: this.message(finding),
        tableId: finding.tableId,
      }));
    return [...structural, ...conventions];
  });
  readonly issuesByTable = $derived(groupBy(this.issues, "tableId"));
  readonly issuesByRef = $derived(groupBy(this.issues, "refId"));

  /** The same findings — `info` included — underlined in the DBML buffer. */
  readonly dbmlFindings = $derived.by((): SchemaFinding[] =>
    this.findings.map((finding) => ({
      severity: finding.severity,
      message: this.message(finding),
      tableName: finding.tableName,
      fieldName: finding.fieldName,
    })),
  );

  /** Lower-case names of the tables whose lock binds this user: their DBML blocks refuse edits. */
  readonly frozenTableNames = $derived.by((): ReadonlySet<string> => {
    const frozen = this.input.frozenTableIds();
    const project = this.input.project();
    if (frozen.size === 0 || !project) return NO_FROZEN_TABLES;
    return new Set(project.tables.filter((table) => frozen.has(table.id)).map((table) => table.name.toLowerCase()));
  });

  private lastLockedEditToast = 0;
  tellLockedEdit = (tableName: string): void => {
    if (Date.now() - this.lastLockedEditToast < LOCKED_EDIT_TOAST_GAP_MS) return;
    this.lastLockedEditToast = Date.now();
    toast.warning(i18n.t("locks.dbmlLocked", { table: tableName }));
  };

  /** `edit` on the project, and no lock that binds this user on the table — notes and fixes are schema edits. */
  canEditTable = (tableId: string): boolean => this.input.canWrite() && !this.input.frozenTableIds().has(tableId);

  /** Applies one of the linter's two safe fixes — one change to the document, so one undo step. */
  fix = (finding: LintFinding): void => {
    const project = this.input.project();
    const doc = this.input.writeDoc();
    if (!project || !doc) return;
    const fixed = applyLintFix(project, finding, generateId)?.tables.find((table) => table.id === finding.tableId);
    if (fixed) getTablesMap(doc).set(fixed.id, fixed);
  };

  saveTableNote = (tableId: string, note: string | undefined): void => {
    const table = this.input.project()?.tables.find((candidate) => candidate.id === tableId);
    const doc = this.input.writeDoc();
    if (table && doc && table.note !== note) getTablesMap(doc).set(tableId, { ...table, note });
  };

  saveFieldNote = (tableId: string, fieldId: string, note: string | undefined): void => {
    const table = this.input.project()?.tables.find((candidate) => candidate.id === tableId);
    const doc = this.input.writeDoc();
    if (!table || !doc || table.fields.find((field) => field.id === fieldId)?.note === note) return;
    getTablesMap(doc).set(tableId, {
      ...table,
      fields: table.fields.map((field) => (field.id === fieldId ? { ...field, note } : field)),
    });
  };
}
