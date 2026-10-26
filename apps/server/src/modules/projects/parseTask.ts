import type { Project } from "@nebuladb/shared";
import {
  applyVisualMetadata,
  describeDbmlParseError,
  parseDbml,
  parseSql,
  toProject,
  type DbmlParseErrorInfo,
  type SqlDialect,
} from "@nebuladb/dbml-engine";

/**
 * The CPU-heavy half of an import — source text in, `Project` out — kept free
 * of anything but the engine so it runs unchanged in the main thread *or* in
 * `parseWorker.ts`. Importing `shared/errors.ts` (and through it the database)
 * from here would drag the whole server into every worker.
 *
 * Never throws: a failure comes back as data, so it crosses a `postMessage`
 * intact (a thrown `CompilerError` would not — its `diags` don't survive the
 * structured clone of an `Error`). A parse failure keeps the engine's
 * diagnostic (a 400 for the caller); a failure *after* a successful parse is
 * a bug, not bad input, and stays a 500 as it was before the worker existed.
 */

export interface ParseTask {
  source: string;
  /** `null` for DBML (visual-metadata sidecar applied), a dialect for SQL DDL. */
  dialect: SqlDialect | null;
  projectName: string;
}

export type ParseResult =
  | { ok: true; project: Project }
  | { ok: false; kind: "parse"; error: DbmlParseErrorInfo }
  | { ok: false; kind: "internal"; message: string };

export function runParseTask({ source, dialect, projectName }: ParseTask): ParseResult {
  let database;
  try {
    database = dialect ? parseSql(source, dialect) : parseDbml(source);
  } catch (err) {
    return { ok: false, kind: "parse", error: describeDbmlParseError(err) };
  }
  try {
    const project = dialect
      ? toProject(database, projectName, source)
      : applyVisualMetadata(toProject(database, projectName, source), source);
    return { ok: true, project };
  } catch (err) {
    return { ok: false, kind: "internal", message: err instanceof Error ? err.message : String(err) };
  }
}
