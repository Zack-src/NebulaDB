import type { Project } from "@nebuladb/shared";

// Zero `@dbml/core` import, like validate.ts: the editor lists the variables a
// schema uses, the server resolves them before it compares or deploys.

/**
 * Per-environment variables: one schema, deployed under names that differ
 * from stage to stage. A table's name or schema may hold `{{variable}}`
 * placeholders — `Table "{{table_prefix}}orders"`, schema `{{schema}}` —
 * and each stage gives the variables their values. They are resolved on the
 * way to a database (diff, DDL, seeds) and nowhere else: the project itself
 * keeps the placeholders.
 */
const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
export const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
/** A fragment of an identifier — letters, digits, `_`, `$`, `-`, `.` — or nothing (e.g. "no prefix on this stage"). */
export const VARIABLE_VALUE = /^[A-Za-z0-9_$.-]{0,64}$/;
export const VARIABLES_MAX = 30;

export type VariableValues = Record<string, string>;

/** Checks values that came from outside; `null` when they are not a set of variables. */
export function parseVariableValues(raw: unknown): VariableValues | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > VARIABLES_MAX) return null;
  const values: VariableValues = {};
  for (const [name, value] of entries) {
    if (!VARIABLE_NAME.test(name) || typeof value !== "string" || !VARIABLE_VALUE.test(value)) return null;
    values[name] = value;
  }
  return values;
}

const placeholdersIn = (text: string | undefined) => [...(text ?? "").matchAll(PLACEHOLDER)].map((match) => match[1]);

/** The variables a schema's table names and schemas refer to, sorted. */
export function variablesUsed(project: Pick<Project, "tables">): string[] {
  const used = new Set<string>();
  for (const table of project.tables) {
    for (const name of [...placeholdersIn(table.name), ...placeholdersIn(table.schemaName)]) used.add(name);
  }
  return [...used].sort();
}

/** Whether a name holds a placeholder — such a name is a template, not yet an identifier. */
export const hasVariables = (text: string) => placeholdersIn(text).length > 0;

/** A name with its placeholders taken out: what naming rules should look at. */
export const withoutVariables = (text: string) => text.replace(PLACEHOLDER, "");

export interface VariableResolution {
  /** The schema as the stage names it — same ids, so seeds and locks still find their tables. */
  project: Project;
  used: string[];
  /** Used by the schema, given no value by the stage. */
  missing: string[];
  /** Tables left without a name once resolved (a name that was only a placeholder with an empty value). */
  unnamed: string[];
  /** Resolved names two tables or more end up sharing. */
  collisions: string[];
}

/**
 * The schema with every placeholder replaced by the stage's value. Nothing is
 * guessed: a variable without a value stays in `missing`, and the caller
 * refuses to go to the database with it.
 */
export function resolveVariables(project: Project, values: VariableValues): VariableResolution {
  const used = variablesUsed(project);
  const missing = used.filter((name) => values[name] === undefined);
  if (used.length === 0) return { project, used, missing, unnamed: [], collisions: [] };

  const fill = (text: string) => text.replace(PLACEHOLDER, (placeholder, name: string) => values[name] ?? placeholder);
  const unnamed: string[] = [];
  const seen = new Map<string, number>();
  const tables = project.tables.map((table) => {
    const name = fill(table.name);
    // An empty schema is "the engine's default schema", exactly like no schema at all.
    const schemaName = table.schemaName === undefined ? undefined : fill(table.schemaName) || undefined;
    if (!name) unnamed.push(table.name);
    const key = `${schemaName ?? ""}.${name}`.toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
    return name === table.name && schemaName === table.schemaName ? table : { ...table, name, schemaName };
  });
  const collisions = [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key.replace(/^\./, ""));
  return { project: { ...project, tables }, used, missing, unnamed, collisions };
}
