import type { Field, Project, Table } from "@athanordb/shared";
import { parseNote, type DataClassification } from "./dictionary.js";
import { withoutVariables } from "./variables.js";

// Zero `@dbml/core` import, like validate.ts: the editor runs this on every
// change and the server runs the very same function before a deployment.

/**
 * Schema linter: conventions a team chose, as opposed to `validateProject`,
 * which reports what is structurally broken whatever the team thinks.
 *
 * A rule has a level per profile; a project picks a profile, may override
 * single rules, and may except a table from a rule — in its settings or with
 * `lint-ignore: rule-id` in the table's note, which travels with the DBML.
 */
export const LINT_RULES = [
  "pk-required",
  "fk-indexed",
  "naming-snake-case",
  "varchar-length",
  "timestamps",
  "no-float-money",
  "table-description",
  "forbidden-type",
  "required-column",
  "column-description",
  "personal-data-class",
  "fk-on-delete",
] as const;

export type LintRuleId = (typeof LINT_RULES)[number];
export type LintSeverity = "info" | "warning" | "error";
export type LintLevel = LintSeverity | "off";
export const LINT_LEVELS: readonly LintLevel[] = ["off", "info", "warning", "error"];

export const LINT_PROFILES = ["relaxed", "standard", "strict", "custom"] as const;
export type LintProfile = (typeof LINT_PROFILES)[number];

const PROFILE_LEVELS: Record<Exclude<LintProfile, "custom">, Record<LintRuleId, LintLevel>> = {
  relaxed: {
    "pk-required": "warning",
    "fk-indexed": "info",
    "naming-snake-case": "off",
    "varchar-length": "off",
    timestamps: "off",
    "no-float-money": "warning",
    "table-description": "off",
    "forbidden-type": "warning",
    "required-column": "info",
    "column-description": "off",
    "personal-data-class": "off",
    "fk-on-delete": "off",
  },
  standard: {
    "pk-required": "warning",
    "fk-indexed": "warning",
    "naming-snake-case": "warning",
    "varchar-length": "info",
    timestamps: "info",
    "no-float-money": "warning",
    "table-description": "info",
    "forbidden-type": "error",
    "required-column": "warning",
    "column-description": "off",
    "personal-data-class": "warning",
    "fk-on-delete": "off",
  },
  strict: {
    "pk-required": "error",
    "fk-indexed": "error",
    "naming-snake-case": "error",
    "varchar-length": "warning",
    timestamps: "warning",
    "no-float-money": "error",
    "table-description": "warning",
    "forbidden-type": "error",
    "required-column": "error",
    "column-description": "info",
    "personal-data-class": "error",
    "fk-on-delete": "info",
  },
};

/** One table excepted from one rule. Keyed by table id (stable across renames); the name is what the list shows. */
export interface LintIgnore {
  ruleId: LintRuleId;
  tableId: string;
  tableName: string;
}

export interface LintSettings {
  profile: LintProfile;
  /** Levels that differ from the profile's (the base of `custom` is `standard`). */
  rules: Partial<Record<LintRuleId, LintLevel>>;
  ignores: LintIgnore[];
  /** Column types no table may use — the `forbidden-type` rule (base type, case-insensitive). */
  forbiddenTypes: string[];
  /** Columns every table must have — the `required-column` rule. */
  requiredColumns: string[];
  /** Refuse a deployment while a finding of level `error` is open. */
  blockDeployment: boolean;
}

export const DEFAULT_LINT_SETTINGS: LintSettings = {
  profile: "standard",
  rules: {},
  ignores: [],
  forbiddenTypes: [],
  requiredColumns: [],
  blockDeployment: false,
};

export interface LintFinding {
  ruleId: LintRuleId;
  severity: LintSeverity;
  tableId: string;
  tableName: string;
  fieldId?: string;
  fieldName?: string;
  /** English, for the API and logs; the editor builds its own text from `ruleId` and `params`. */
  message: string;
  params: Record<string, string>;
  /** `applyLintFix` knows a change that settles it without a decision to take. */
  fixable: boolean;
}

const MAX_LIST = 50;
const MAX_IGNORES = 500;
const MAX_NAME = 128;

function isStringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_LIST &&
    value.every((item) => typeof item === "string" && item.trim().length > 0 && item.length <= MAX_NAME)
  );
}

const uniqueTrimmed = (list: string[]) => [...new Set(list.map((item) => item.trim()))];

/** Checks settings that came from outside (a request body, a stored row); `null` when they are not settings. */
export function parseLintSettings(raw: unknown): LintSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  if (!LINT_PROFILES.includes(body.profile as LintProfile)) return null;

  const rules: Partial<Record<LintRuleId, LintLevel>> = {};
  const rawRules = body.rules ?? {};
  if (typeof rawRules !== "object" || rawRules === null || Array.isArray(rawRules)) return null;
  for (const [ruleId, level] of Object.entries(rawRules)) {
    if (!LINT_RULES.includes(ruleId as LintRuleId) || !LINT_LEVELS.includes(level as LintLevel)) return null;
    rules[ruleId as LintRuleId] = level as LintLevel;
  }

  const rawIgnores = body.ignores ?? [];
  if (!Array.isArray(rawIgnores) || rawIgnores.length > MAX_IGNORES) return null;
  const ignores = new Map<string, LintIgnore>();
  for (const item of rawIgnores) {
    const entry = (item ?? {}) as Record<string, unknown>;
    if (!LINT_RULES.includes(entry.ruleId as LintRuleId)) return null;
    if (typeof entry.tableId !== "string" || !entry.tableId || entry.tableId.length > MAX_NAME) return null;
    if (typeof entry.tableName !== "string" || entry.tableName.length > MAX_NAME) return null;
    ignores.set(`${entry.ruleId}:${entry.tableId}`, {
      ruleId: entry.ruleId as LintRuleId,
      tableId: entry.tableId,
      tableName: entry.tableName,
    });
  }

  const forbiddenTypes = body.forbiddenTypes ?? [];
  const requiredColumns = body.requiredColumns ?? [];
  if (!isStringList(forbiddenTypes) || !isStringList(requiredColumns)) return null;
  if (body.blockDeployment !== undefined && typeof body.blockDeployment !== "boolean") return null;

  return {
    profile: body.profile as LintProfile,
    rules,
    ignores: [...ignores.values()],
    forbiddenTypes: uniqueTrimmed(forbiddenTypes),
    requiredColumns: uniqueTrimmed(requiredColumns),
    blockDeployment: body.blockDeployment === true,
  };
}

/** The level each rule runs at: the profile's, then the project's own overrides. */
export function resolveLintLevels(settings: LintSettings): Record<LintRuleId, LintLevel> {
  const base = PROFILE_LEVELS[settings.profile === "custom" ? "standard" : settings.profile];
  return { ...base, ...settings.rules };
}

/** `decimal(10,2)` -> `decimal`, `varchar[]` -> `varchar`. */
function baseType(type: string): string {
  return type.replace(/\(.*$/, "").replace(/\[\]$/, "").trim().toLowerCase();
}

const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const UNSIZED_TEXT_TYPES = new Set(["varchar", "nvarchar", "varchar2", "nvarchar2", "character varying"]);
const FLOAT_TYPES = new Set(["float", "float4", "float8", "real", "double", "double precision", "binary_float"]);
const MONEY_NAME =
  /(^|_)(price|amount|total|subtotal|cost|balance|salary|fee|tax|vat|montant|prix|solde|tarif|tva)(_|$)/i;
const TIMESTAMP_COLUMNS = ["created_at", "updated_at"];
const IGNORE_NOTE = /lint-ignore:\s*([a-z0-9,\s-]+)/gi;

/** Rules a table's own note excepts it from: `lint-ignore: pk-required, timestamps` (or `all`). */
function rulesIgnoredByNote(table: Table): Set<string> {
  const ignored = new Set<string>();
  for (const match of (table.note ?? "").matchAll(IGNORE_NOTE)) {
    for (const ruleId of match[1].split(/[\s,]+/)) if (ruleId) ignored.add(ruleId.toLowerCase());
  }
  return ignored;
}

const hasPrimaryKey = (table: Table) => table.fields.some((f) => f.pk) || table.indexes.some((idx) => idx.pk);
const hasColumn = (table: Table, name: string) => table.fields.some((f) => f.name.toLowerCase() === name.toLowerCase());

/** A lookup on this column can use an index: it is the key, unique, or the first column of an index. */
function isIndexed(table: Table, field: Field): boolean {
  return Boolean(field.pk || field.unique) || table.indexes.some((idx) => idx.fieldIds[0] === field.id);
}

/** Columns whose name says what they are: the description rule does not ask for one. */
const isSelfExplanatory = (field: Field) =>
  (field.pk && field.name.toLowerCase() === "id") || TIMESTAMP_COLUMNS.includes(field.name.toLowerCase());

/** `personal` and `sensitive` are the classes a table has to announce. */
const isPersonal = (classification?: DataClassification) =>
  classification === "personal" || classification === "sensitive";

const SEVERITY_ORDER: Record<LintSeverity, number> = { error: 0, warning: 1, info: 2 };

/** Every finding of the rules that are on, most severe first, then by table and rule. */
export function lintProject(project: Project, settings: LintSettings = DEFAULT_LINT_SETTINGS): LintFinding[] {
  const levels = resolveLintLevels(settings);
  const ignoredInSettings = new Set(settings.ignores.map((ignore) => `${ignore.ruleId}:${ignore.tableId}`));
  const forbidden = new Set(settings.forbiddenTypes.map((type) => baseType(type)));
  const findings: LintFinding[] = [];

  const foreignKeysByTable = new Map<string, Set<string>>();
  // Foreign-key columns whose relation does not say what deleting the referenced row does.
  const withoutOnDelete = new Map<string, Set<string>>();
  for (const ref of project.refs) {
    const set = foreignKeysByTable.get(ref.from.tableId) ?? new Set<string>();
    set.add(ref.from.fieldId);
    foreignKeysByTable.set(ref.from.tableId, set);
    if (!ref.onDelete) {
      const undecided = withoutOnDelete.get(ref.from.tableId) ?? new Set<string>();
      undecided.add(ref.from.fieldId);
      withoutOnDelete.set(ref.from.tableId, undecided);
    }
  }

  for (const table of project.tables) {
    const ignoredInNote = rulesIgnoredByNote(table);
    const report = (
      ruleId: LintRuleId,
      message: string,
      params: Record<string, string> = {},
      extra: { field?: Field; fixable?: boolean } = {},
    ) => {
      const level = levels[ruleId];
      if (level === "off") return;
      if (ignoredInNote.has(ruleId) || ignoredInNote.has("all")) return;
      if (ignoredInSettings.has(`${ruleId}:${table.id}`)) return;
      findings.push({
        ruleId,
        severity: level,
        tableId: table.id,
        tableName: table.name,
        fieldId: extra.field?.id,
        fieldName: extra.field?.name,
        message,
        params: { table: table.name, ...(extra.field ? { column: extra.field.name } : {}), ...params },
        fixable: extra.fixable ?? false,
      });
    };

    if (!hasPrimaryKey(table)) {
      report("pk-required", `Table "${table.name}" has no primary key`, {}, { fixable: !hasColumn(table, "id") });
    }

    for (const fieldId of foreignKeysByTable.get(table.id) ?? []) {
      const field = table.fields.find((f) => f.id === fieldId);
      if (field && !isIndexed(table, field)) {
        report("fk-indexed", `Foreign key "${table.name}.${field.name}" has no index`, {}, { field, fixable: true });
      }
    }

    for (const fieldId of withoutOnDelete.get(table.id) ?? []) {
      const field = table.fields.find((f) => f.id === fieldId);
      if (field) {
        report(
          "fk-on-delete",
          `Foreign key "${table.name}.${field.name}" does not say what a delete does`,
          {},
          { field },
        );
      }
    }

    // A `{{variable}}` in a table's name is filled in per stage: the rule looks at what is written around it.
    if (!SNAKE_CASE.test(withoutVariables(table.name) || "x")) {
      report("naming-snake-case", `Table name "${table.name}" is not snake_case`, { name: table.name });
    }

    for (const field of table.fields) {
      const type = baseType(field.type);
      if (!SNAKE_CASE.test(field.name)) {
        report(
          "naming-snake-case",
          `Column name "${table.name}.${field.name}" is not snake_case`,
          { name: field.name },
          { field },
        );
      }
      if (UNSIZED_TEXT_TYPES.has(type) && !field.type.includes("(")) {
        report(
          "varchar-length",
          `"${table.name}.${field.name}" is ${field.type} without a length`,
          { type: field.type },
          { field },
        );
      }
      if (FLOAT_TYPES.has(type) && MONEY_NAME.test(field.name)) {
        report(
          "no-float-money",
          `"${table.name}.${field.name}" holds an amount as ${field.type} — use a decimal type`,
          { type: field.type },
          { field },
        );
      }
      if (forbidden.has(type)) {
        report(
          "forbidden-type",
          `"${table.name}.${field.name}" uses the forbidden type ${field.type}`,
          { type: field.type },
          { field },
        );
      }
    }

    const missingTimestamps = TIMESTAMP_COLUMNS.filter((name) => !hasColumn(table, name));
    if (missingTimestamps.length > 0) {
      report("timestamps", `Table "${table.name}" has no ${missingTimestamps.join(" / ")} column`, {
        columns: missingTimestamps.join(", "),
      });
    }

    // Neither the linter's own annotation nor the dictionary's (`[owner: …]`) says what the table is.
    if (!parseNote(table.note).description.replace(IGNORE_NOTE, "").trim()) {
      report("table-description", `Table "${table.name}" has no description`);
    }

    const undescribed = table.fields.filter((field) => !isSelfExplanatory(field) && !parseNote(field.note).description);
    if (undescribed.length > 0) {
      const names = undescribed.map((field) => field.name).join(", ");
      report("column-description", `Table "${table.name}" has column(s) without a description: ${names}`, {
        columns: names,
        count: String(undescribed.length),
      });
    }

    if (!isPersonal(parseNote(table.note).classification)) {
      for (const field of table.fields) {
        const classification = parseNote(field.note).classification;
        if (isPersonal(classification)) {
          report(
            "personal-data-class",
            `"${table.name}.${field.name}" is ${classification} data in a table not classified as such`,
            { classification: classification ?? "" },
            { field },
          );
        }
      }
    }

    const missingRequired = settings.requiredColumns.filter((name) => !hasColumn(table, name));
    if (missingRequired.length > 0) {
      report("required-column", `Table "${table.name}" lacks the required column(s) ${missingRequired.join(", ")}`, {
        columns: missingRequired.join(", "),
      });
    }
  }

  return findings.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.tableName.localeCompare(b.tableName) ||
      LINT_RULES.indexOf(a.ruleId) - LINT_RULES.indexOf(b.ruleId),
  );
}

export interface LintSummary {
  error: number;
  warning: number;
  info: number;
}

export function summarizeLint(findings: LintFinding[]): LintSummary {
  const summary: LintSummary = { error: 0, warning: 0, info: 0 };
  for (const finding of findings) summary[finding.severity] += 1;
  return summary;
}

/**
 * The project with one finding settled, or `null` when the finding has no
 * safe fix (or no longer applies). Only the two changes that need no
 * decision: an `id` key on a table that has neither a key nor an `id`
 * column, and a plain index on a foreign-key column.
 */
export function applyLintFix(project: Project, finding: LintFinding, newId: () => string): Project | null {
  const table = project.tables.find((t) => t.id === finding.tableId);
  if (!table) return null;

  let fixed: Table;
  if (finding.ruleId === "pk-required") {
    if (hasPrimaryKey(table) || hasColumn(table, "id")) return null;
    const id: Field = { id: newId(), name: "id", type: "integer", pk: true, increment: true };
    fixed = { ...table, fields: [id, ...table.fields] };
  } else if (finding.ruleId === "fk-indexed") {
    const field = table.fields.find((f) => f.id === finding.fieldId);
    if (!field || isIndexed(table, field)) return null;
    fixed = { ...table, indexes: [...table.indexes, { id: newId(), fieldIds: [field.id] }] };
  } else {
    return null;
  }
  return { ...project, tables: project.tables.map((t) => (t.id === table.id ? fixed : t)) };
}
