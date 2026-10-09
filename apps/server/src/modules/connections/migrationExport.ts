import type { DatabaseEngine } from "@nebuladb/shared";
import { createZip } from "../../shared/zip.js";
import { listDeploymentsForExport, type DeploymentExportRow } from "./deploymentHistory.js";

export const MIGRATION_FORMATS = ["sql", "flyway", "liquibase"] as const;
export type MigrationFormat = (typeof MIGRATION_FORMATS)[number];

export function isMigrationFormat(value: unknown): value is MigrationFormat {
  return typeof value === "string" && (MIGRATION_FORMATS as readonly string[]).includes(value);
}

export interface ExportedFile {
  /** Path inside the archive. */
  name: string;
  content: string;
  modifiedAt?: Date;
}

/** Liquibase's names for the engines (`dbms:` on a changeset). */
const LIQUIBASE_DBMS: Record<DatabaseEngine, string> = {
  postgres: "postgresql",
  mysql: "mysql",
  mssql: "mssql",
  oracle: "oracle",
  sqlite: "sqlite",
  bigquery: "bigquery",
};

/**
 * Both tools run a migration in a transaction of their own; the BEGIN/COMMIT
 * the generator wraps a deployment in would end it early. Only a wrapper that
 * is the first and last statement of the file is removed.
 */
const TRANSACTION_START = /^(begin|begin transaction|start transaction);$/i;
const TRANSACTION_END = /^(commit|commit transaction);$/i;

function isComment(line: string): boolean {
  return line.trim().startsWith("--");
}

function stripTransactionWrapper(sql: string): string {
  const lines = sql.split(/\r?\n/);
  const code = (i: number) => lines[i]!.trim() !== "" && !isComment(lines[i]!);
  const first = lines.findIndex((_, i) => code(i));
  if (first >= 0 && TRANSACTION_START.test(lines[first]!.trim())) lines.splice(first, 1);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!code(i)) continue;
    if (TRANSACTION_END.test(lines[i]!.trim())) lines.splice(i, 1);
    break;
  }
  return lines.join("\n");
}

/** Whether the SQL does anything: "-- No schema differences detected" does not. */
function hasStatements(sql: string | null): sql is string {
  return Boolean(sql?.split(/\r?\n/).some((line) => line.trim() !== "" && !isComment(line)));
}

/** A value fit for one comment line — a project name with a line break must not smuggle SQL into the header. */
function oneLine(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim();
}

function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** `2026-10-09 12:00:00` (SQLite's UTC `datetime('now')`) as ISO 8601. */
function isoDate(createdAt: string): string {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(createdAt) ? `${createdAt.replace(" ", "T")}Z` : createdAt;
}

function parseDate(createdAt: string): Date | undefined {
  const date = new Date(isoDate(createdAt));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function authorOf(entry: DeploymentExportRow): string {
  return oneLine(entry.executedByName ?? entry.executedByEmail ?? "-") || "-";
}

interface Migration {
  entry: DeploymentExportRow;
  version: number;
  /** `0001` */
  padded: string;
  /** What follows the version in a file name. */
  description: string;
  up: string;
  down: string | null;
}

export interface MigrationExportInput {
  projectName: string;
  /** The connection's name now; each file's header uses the name it had when it ran. */
  connectionName: string;
  format: MigrationFormat;
  /** Oldest first. */
  entries: DeploymentExportRow[];
  exportedAt: Date;
}

/**
 * Turns a connection's history into migration files.
 *
 * - Only successful deployments with something to run are exported, in the
 *   order they ran. Version = position among those: history only ever grows
 *   at the end and a row's outcome never changes, so a later export keeps
 *   every earlier file name and adds the new ones.
 * - A successful rollback is a migration of its own (its SQL is the inverse of
 *   the deployment it undoes), kept after the deployment: dropping both would
 *   break every later migration that was generated against the rolled-back
 *   state, and replaying the sequence stays exactly what happened.
 * - Failed and partial deployments are listed in the README only; seeds are
 *   not stored as SQL, so they are reported there too and not exported.
 */
export function buildMigrationExport(input: MigrationExportInput): ExportedFile[] {
  const { projectName, format, entries } = input;

  const migrations: Migration[] = [];
  const versionById = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.success || !hasStatements(entry.sql)) continue;
    const version = migrations.length + 1;
    versionById.set(entry.id, version);
    const padded = String(version).padStart(4, "0");
    const target = entry.rollbackOf ? versionById.get(entry.rollbackOf) : undefined;
    const hash = entry.schemaHash ? slug(entry.schemaHash).slice(0, 8) : "";
    const description = entry.rollbackOf
      ? target
        ? `rollback_of_${String(target).padStart(4, "0")}`
        : "rollback"
      : hash
        ? `schema_${hash}`
        : "deployment";
    const wrapped = format !== "sql";
    migrations.push({
      entry,
      version,
      padded,
      description,
      up: wrapped ? stripTransactionWrapper(entry.sql) : entry.sql,
      down: hasStatements(entry.rollbackSql)
        ? wrapped
          ? stripTransactionWrapper(entry.rollbackSql)
          : entry.rollbackSql
        : null,
    });
  }

  const header = (m: Migration, kind: "up" | "down"): string =>
    [
      `-- NebulaDB migration ${m.padded}${kind === "down" ? " (rollback)" : ""}`,
      `-- Project: ${oneLine(projectName)}`,
      `-- Connection: ${oneLine(m.entry.connectionName)}`,
      `-- Environment: ${oneLine(m.entry.environment ?? "") || "-"}`,
      `-- Date: ${isoDate(m.entry.createdAt)}`,
      `-- Author: ${authorOf(m.entry)}`,
      `-- Schema hash: ${oneLine(m.entry.schemaHash ?? "") || "-"}`,
    ].join("\n");

  const files: ExportedFile[] = [];
  const add = (name: string, content: string, m?: Migration) =>
    files.push({ name: `migrations/${name}`, content, modifiedAt: m ? parseDate(m.entry.createdAt) : undefined });

  for (const m of migrations) {
    const base = format === "flyway" ? `V${m.padded}__${m.description}` : `${m.padded}_${m.description}`;
    if (format === "liquibase") {
      const lines = [
        "--liquibase formatted sql",
        header(m, "up"),
        "",
        // The author is a constant: Liquibase identifies a changeset by id, author and file, and a person's display name can change.
        `--changeset nebuladb:${m.padded} splitStatements:true endDelimiter:; dbms:${LIQUIBASE_DBMS[m.entry.engine] ?? m.entry.engine}`,
        `--comment: Deployed by ${authorOf(m.entry)}`,
        m.up.trim(),
      ];
      if (m.down) {
        const down = m.down.split(/\r?\n/).filter((line) => line.trim() !== "");
        lines.push(
          "",
          ...down.filter(isComment),
          ...down.filter((line) => !isComment(line)).map((line) => `--rollback ${line}`),
        );
      }
      add(`${base}.sql`, `${lines.join("\n")}\n`, m);
      continue;
    }
    add(`${base}.sql`, `${header(m, "up")}\n\n${m.up.trim()}\n`, m);
    if (m.down) {
      const undo = format === "flyway" ? `U${m.padded}__${m.description}` : `${base}.down`;
      add(`${undo}.sql`, `${header(m, "down")}\n\n${m.down.trim()}\n`, m);
    }
  }

  if (format === "liquibase") {
    const includes = migrations.map(
      (m) => `  - include:\n      file: ${m.padded}_${m.description}.sql\n      relativeToChangelogFile: true`,
    );
    add(
      "changelog-master.yaml",
      [
        `# NebulaDB changelog — ${oneLine(projectName)} / ${oneLine(input.connectionName)}`,
        includes.length > 0 ? `databaseChangeLog:\n${includes.join("\n")}` : "databaseChangeLog: []",
        "",
      ].join("\n"),
    );
  }

  files.push({ name: "README.md", content: buildReadme(input, migrations) });
  return files;
}

function buildReadme(input: MigrationExportInput, migrations: Migration[]): string {
  const { format, entries } = input;
  const included = new Set(migrations.map((m) => m.entry.id));
  const failed = entries.filter((e) => !e.success);
  const noops = entries.filter((e) => e.success && !included.has(e.id));
  const engines = [...new Set(entries.map((e) => e.engine))].join(", ") || "-";
  const seeds = entries.filter((e) => e.success && (e.seedReport?.length ?? 0) > 0);
  const out: string[] = [
    `# Migrations — ${oneLine(input.projectName)} / ${oneLine(input.connectionName)}`,
    "",
    `- Exported: ${input.exportedAt.toISOString()}`,
    `- Format: ${format}`,
    `- Engine: ${engines}`,
    `- Migrations: ${migrations.length}`,
    "",
    "## Files",
    "",
    "| Version | Deployed | By | Kind | Schema hash |",
    "| --- | --- | --- | --- | --- |",
    ...migrations.map(
      (m) =>
        `| ${m.padded} | ${isoDate(m.entry.createdAt)} | ${authorOf(m.entry)} | ${m.entry.rollbackOf ? "rollback" : "deployment"}${m.down ? " (with undo)" : ""} | ${oneLine(m.entry.schemaHash ?? "") || "-"} |`,
    ),
    "",
    "Version numbers are the position among the successful deployments, oldest first. They never change: a later export adds files at the end.",
    "",
    "## What is in the archive",
    "",
    "- Only successful deployments, in the order they ran.",
    "- A rollback that succeeded is exported as a migration of its own, after the deployment it undid (both are kept). Later migrations were generated against the state after the rollback, so dropping the pair would break them; replaying the whole sequence gives the state the history describes. A rollback has no undo file.",
    "- Failed and partial deployments are not exported (listed below).",
    "- Seeds: the rows a deployment inserted are not stored as SQL, so they are not in the files. Seed data has to be loaded another way.",
    "- Credentials, hosts and connection strings are never written to this archive.",
    format === "sql"
      ? "- Plain SQL: `NNNN_<name>.sql`, and `NNNN_<name>.down.sql` when a rollback was generated. The BEGIN/COMMIT around each deployment is kept."
      : format === "flyway"
        ? "- Flyway: `V<version>__<description>.sql` with `U<version>__<description>.sql` undo files (Flyway Teams edition). Point `flyway.locations` at the `migrations` folder. The BEGIN/COMMIT around each deployment is removed: Flyway runs each migration in its own transaction."
        : "- Liquibase: one formatted-SQL changeset file per deployment (author `nebuladb`, id = version), the generated rollback in `--rollback` lines, and `changelog-master.yaml` including them in order. Run `liquibase --changelog-file=migrations/changelog-master.yaml update`. The BEGIN/COMMIT around each deployment is removed: Liquibase runs each changeset in its own transaction. A changeset with no `--rollback` line cannot be rolled back by Liquibase.",
    "",
    "## Not guaranteed",
    "",
    "- Changes made to the database outside Nebula (by hand, by another tool, by a database administrator) are not in the history, so not in these files.",
    "- The first migration is the difference between the schema and the database as it was at that moment. If the database already had objects then, replaying these files on an empty database does not recreate them.",
    "- Rollback SQL is best effort, generated when the deployment ran; the statements it could not reverse are flagged with `-- WARNING` comments.",
    "- Data transformations chosen when risks were accepted are part of the SQL; data itself (including seeds) is not.",
    "",
    "## Left out: failed or partial deployments",
    "",
    ...(failed.length > 0
      ? failed.map(
          (e) =>
            `- ${isoDate(e.createdAt)} by ${authorOf(e)}: ${e.rollbackOf ? "rollback" : "deployment"} ${e.executedStatements > 0 ? "partial" : "failed"} (${e.executedStatements}/${e.totalStatements} statements ran)${e.executedStatements > 0 ? ". It changed the database before failing; those changes are not in the files." : ""}`,
        )
      : ["None."]),
    "",
  ];
  if (noops.length > 0) {
    out.push(`${noops.length} successful deployment(s) had no statement to run and are not exported.`, "");
  }
  if (seeds.length > 0) {
    out.push(
      "## Seeds inserted by exported deployments (not in the files)",
      "",
      ...seeds.map(
        (e) =>
          `- ${isoDate(e.createdAt)}: ${e.seedReport!.map((r) => `${oneLine(r.tableName)} ${r.error ? "failed" : r.skipped ? "skipped" : `+${r.inserted}`}`).join(", ")}`,
      ),
      "",
    );
  }
  return out.join("\n");
}

const slugOrDefault = (text: string, fallback: string) => slug(text).replace(/_/g, "-") || fallback;

/** The archive for one connection of one project, and the name to download it as. */
export function exportMigrations(
  projectId: string,
  projectName: string,
  connection: { id: string; name: string },
  format: MigrationFormat,
): { fileName: string; archive: Buffer; files: number } {
  const entries = listDeploymentsForExport(projectId, connection.id);
  const files = buildMigrationExport({
    projectName,
    connectionName: connection.name,
    format,
    entries,
    exportedAt: new Date(),
  });
  const archive = createZip(files.map((f) => ({ name: f.name, data: f.content, modifiedAt: f.modifiedAt })));
  return {
    fileName: `${slugOrDefault(projectName, "project")}-${slugOrDefault(connection.name, "connection")}-${format}.zip`,
    archive,
    files: files.length,
  };
}
