import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Project } from "@nebuladb/shared";
import type { CommandId, OptionValues } from "./args.js";
import { UsageError } from "./args.js";

/**
 * The commands that run on a file, with the DBML engine in this process: no instance address and
 * no API key are read for them. The engine is imported on demand so the other commands do not pay
 * for parsing DBML.
 */
export const OFFLINE_COMMANDS: ReadonlySet<CommandId> = new Set<CommandId>(["lint.file", "diff.files"]);

export interface OfflineOutcome {
  failed: boolean;
  data: unknown;
  text: string;
}

interface OfflineContext {
  positionals: string[];
  values: OptionValues;
}

/** A DBML file that does not parse: the exit code is 1 (the check found something), the message says where. */
export class DbmlSyntaxError extends Error {}

async function readSource(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new UsageError(`cannot read ${path}${code ? ` (${code})` : ""}`);
  }
}

/**
 * The file as a `Project` whose ids are stable across two parses of two files: @dbml/core numbers
 * tables and fields in reading order, which would make every table after an insertion look changed.
 * Ids built from the names match what a human means by "the same table".
 */
async function loadProject(path: string): Promise<{ project: Project; source: string }> {
  const source = await readSource(path);
  const engine = await import("@nebuladb/dbml-engine");
  let project: Project;
  try {
    project = engine.toProject(engine.parseDbml(source), basename(path).replace(/\.dbml$/i, ""), source);
  } catch (err) {
    const info = engine.describeDbmlParseError(err);
    const where = info.line !== undefined ? `:${info.line}${info.column !== undefined ? `:${info.column}` : ""}` : "";
    throw new DbmlSyntaxError(`${path}${where}: ${info.message}`);
  }
  return { project: stabilizeIds(project), source };
}

export function stabilizeIds(project: Project): Project {
  const tableIds = new Map<string, string>();
  const fieldIds = new Map<string, string>();
  const tables = project.tables.map((table) => {
    const id = table.schemaName ? `${table.schemaName}.${table.name}` : table.name;
    tableIds.set(table.id, id);
    return {
      ...table,
      id,
      fields: table.fields.map((field) => {
        const fid = `${id}.${field.name}`;
        fieldIds.set(`${table.id}\u0000${field.id}`, fid);
        return { ...field, id: fid };
      }),
    };
  });
  const refs = project.refs.map((ref) => {
    const end = (e: { tableId: string; fieldId: string }) => ({
      tableId: tableIds.get(e.tableId) ?? e.tableId,
      fieldId: fieldIds.get(`${e.tableId}\u0000${e.fieldId}`) ?? e.fieldId,
    });
    const from = end(ref.from);
    const to = end(ref.to);
    return { ...ref, from, to, id: `${from.fieldId}->${to.fieldId}` };
  });
  return { ...project, tables, refs };
}

export interface Position {
  line: number;
  column: number;
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const quoted = (name: string) => `(?:"${escapeRegex(name)}"|\`${escapeRegex(name)}\`|${escapeRegex(name)})`;

/**
 * Where a table (or one of its fields) is written in the DBML source, 1-based. The engine's
 * findings name entities, not positions, so this reads the text for the declaration: good enough
 * to jump to, and `undefined` rather than a wrong guess when the declaration cannot be found.
 */
export function locate(source: string, schemaName: string | undefined, tableName: string, fieldName?: string): Position | undefined {
  const lines = source.split(/\r?\n/);
  const schemaPart = schemaName ? `${quoted(schemaName)}\\s*\\.\\s*` : "(?:[^\\s.{]+\\s*\\.\\s*)?";
  const header = new RegExp(`^(\\s*)Table\\s+${schemaPart}${quoted(tableName)}(?=[\\s{]|$)`, "i");
  for (let i = 0; i < lines.length; i += 1) {
    const match = header.exec(lines[i]);
    if (!match) continue;
    if (!fieldName) return { line: i + 1, column: match[1].length + 1 };
    const fieldLine = new RegExp(`^(\\s*)${quoted(fieldName)}(?=\\s)`);
    let depth = 0;
    for (let j = i; j < lines.length; j += 1) {
      const text = lines[j];
      if (j > i && depth === 1) {
        const field = fieldLine.exec(text);
        if (field) return { line: j + 1, column: field[1].length + 1 };
      }
      for (const ch of text) {
        if (ch === "{") depth += 1;
        else if (ch === "}") depth -= 1;
      }
      if (depth <= 0 && j >= i && /\}/.test(text)) break;
    }
    return { line: i + 1, column: match[1].length + 1 };
  }
  return undefined;
}

interface LocatedFinding {
  ruleId: string;
  severity: string;
  tableName: string;
  fieldName?: string;
  message: string;
  line?: number;
  column?: number;
}

type LintFormat = "text" | "json" | "markdown";

function lintText(file: string, findings: LocatedFinding[], summary: { error: number; warning: number; info: number }, failOn: string) {
  const lines = findings.map((f) => {
    const at = f.line !== undefined ? `${file}:${f.line}:${f.column ?? 1}` : file;
    const where = f.fieldName ? `${f.tableName}.${f.fieldName}` : f.tableName;
    return `${at}  ${f.severity.padEnd(7)} ${where}: ${f.message} [${f.ruleId}]`;
  });
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  lines.push(
    `${lines.length > 0 ? "\n" : ""}${plural(summary.error, "error")}, ${plural(summary.warning, "warning")}, ${summary.info} info (failing on ${failOn})`,
  );
  return lines.join("\n");
}

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

function lintMarkdown(file: string, findings: LocatedFinding[], summary: { error: number; warning: number; info: number }, failed: boolean) {
  const lines = [
    `### NebulaDB lint: ${failed ? "failed" : "passed"}`,
    "",
    `\`${file}\`: ${summary.error} error(s), ${summary.warning} warning(s), ${summary.info} info.`,
  ];
  if (findings.length > 0) {
    lines.push("", "| Severity | Where | Message | Rule |", "| --- | --- | --- | --- |");
    for (const f of findings) {
      const entity = f.fieldName ? `${f.tableName}.${f.fieldName}` : f.tableName;
      const where = f.line !== undefined ? `\`${entity}\` (line ${f.line})` : `\`${entity}\``;
      lines.push(`| ${f.severity} | ${where} | ${cell(f.message)} | \`${f.ruleId}\` |`);
    }
  }
  return lines.join("\n");
}

export async function lintFile({ positionals: [file], values }: OfflineContext): Promise<OfflineOutcome> {
  const format = (values.json === true ? "json" : typeof values.format === "string" ? values.format : "text") as LintFormat;
  const failOn = values["fail-on"] === "warning" ? "warning" : "error";
  const { project, source } = await loadProject(file);
  const engine = await import("@nebuladb/dbml-engine");
  const tableSchema = new Map(project.tables.map((table) => [table.id, table.schemaName]));
  const tableName = new Map(project.tables.map((table) => [table.id, table.name]));
  const raw = engine.lintProject(project);
  const findings: LocatedFinding[] = raw.map((finding) => {
    const position = locate(source, tableSchema.get(finding.tableId), tableName.get(finding.tableId) ?? finding.tableName, finding.fieldName);
    return {
      ruleId: finding.ruleId,
      severity: finding.severity,
      tableName: finding.tableName,
      ...(finding.fieldName && { fieldName: finding.fieldName }),
      message: finding.message,
      ...(position && { line: position.line, column: position.column }),
    };
  });
  const summary = engine.summarizeLint(raw);
  const failed = summary.error > 0 || (failOn === "warning" && summary.warning > 0);
  const data = { file, failOn, failed, summary, findings };
  const text =
    format === "json"
      ? JSON.stringify(data, null, 2)
      : format === "markdown"
        ? lintMarkdown(file, findings, summary, failed)
        : lintText(file, findings, summary, failOn);
  return { failed, data, text };
}

type FieldLike = { name: string; type: string; pk?: boolean; unique?: boolean; notNull?: boolean; increment?: boolean; default?: string; note?: string };

function describeField(field: FieldLike): string {
  const flags = [field.pk && "pk", field.unique && "unique", field.notNull && "not null", field.increment && "increment"].filter(Boolean);
  return `${field.type}${flags.length > 0 ? ` [${flags.join(", ")}]` : ""}${field.default !== undefined ? ` default ${field.default}` : ""}`;
}

function fieldChangeLines(diff: import("@nebuladb/dbml-engine").FieldDiff): string {
  if (diff.status === "added" && diff.after) return `${diff.name}: ${describeField(diff.after)}`;
  if (diff.status === "removed" && diff.before) return `${diff.name}: ${describeField(diff.before)}`;
  if (diff.before && diff.after) {
    const rename = diff.before.name !== diff.after.name ? `${diff.before.name} -> ${diff.after.name}: ` : `${diff.name}: `;
    return `${rename}${describeField(diff.before)} -> ${describeField(diff.after)}`;
  }
  return diff.name;
}

function refLabel(ref: import("@nebuladb/shared").Ref): string {
  return `${ref.from.fieldId} ${ref.cardinality} ${ref.to.fieldId}`;
}

type DiffFormat = "text" | "json" | "markdown";

function diffLines(diff: import("@nebuladb/dbml-engine").ProjectDiff, markdown: boolean): string[] {
  const sign = { added: "+", removed: "-", changed: "~" } as const;
  const bullet = (indent: number, text: string, status: keyof typeof sign) =>
    markdown ? `${"  ".repeat(indent)}- ${text}` : `${"  ".repeat(indent)}${sign[status]} ${text}`;
  const code = (text: string) => (markdown ? `\`${text}\`` : text);
  const lines: string[] = [];
  for (const table of diff.tables) {
    const rename = table.renamedFrom ? ` (was ${table.renamedFrom})` : "";
    lines.push(bullet(0, `${table.status} table ${code(table.name)}${rename}`, table.status));
    for (const field of table.fields) lines.push(bullet(1, `${field.status} ${fieldChangeLines(field)}`, field.status));
  }
  for (const ref of diff.refs) {
    const target = ref.after ?? ref.before;
    lines.push(bullet(0, `${ref.status} ref ${code(target ? refLabel(target) : ref.id)}`, ref.status));
  }
  return lines;
}

export async function diffFiles({ positionals: [oldFile, newFile], values }: OfflineContext): Promise<OfflineOutcome> {
  const format = (values.json === true ? "json" : typeof values.format === "string" ? values.format : "text") as DiffFormat;
  const engine = await import("@nebuladb/dbml-engine");
  const before = (await loadProject(oldFile)).project;
  const after = (await loadProject(newFile)).project;
  const diff = engine.diffProjects(before, after);
  const changes = diff.tables.length + diff.refs.length;
  const counts = {
    tables: diff.tables.length,
    fields: diff.tables.reduce((n, t) => n + t.fields.length, 0),
    refs: diff.refs.length,
  };
  const data = { old: oldFile, new: newFile, changes, counts, ...diff };
  const failed = values["exit-code"] === true && changes > 0;

  let text: string;
  if (format === "json") text = JSON.stringify(data, null, 2);
  else if (format === "markdown") {
    text = [
      "### NebulaDB schema diff",
      "",
      changes === 0
        ? `No schema change between \`${oldFile}\` and \`${newFile}\`.`
        : `\`${oldFile}\` to \`${newFile}\`: ${counts.tables} table(s) and ${counts.refs} reference(s) changed, ${counts.fields} field change(s).`,
      ...(changes === 0 ? [] : ["", ...diffLines(diff, true)]),
    ].join("\n");
  } else {
    text = changes === 0 ? "No schema change." : [...diffLines(diff, false), "", `${counts.tables} table(s), ${counts.fields} field change(s), ${counts.refs} ref(s) changed`].join("\n");
  }
  return { failed, data, text };
}

export const OFFLINE_HANDLERS: Record<string, (context: OfflineContext) => Promise<OfflineOutcome>> = {
  "lint.file": lintFile,
  "diff.files": diffFiles,
};
