import { readFile, writeFile } from "node:fs/promises";
import { UsageError, type CommandId, type OptionValues } from "./args.js";
import type { ApiClient } from "./client.js";
import {
  formatDeploy,
  formatDrift,
  formatLint,
  formatPlan,
  formatProjects,
  formatReviews,
  openFindings,
  type DeploymentPlan,
  type DeployResult,
  type LintReport,
  type MonitoringCheck,
  type ProjectRow,
  type ReviewRow,
} from "./format.js";

/** What a command did: the text for a person, the data for `--json`, and whether the run counts as failed (exit 1). */
export interface Outcome {
  failed: boolean;
  data: unknown;
  text: string;
  /** `text` is a file's content to print as is, without a trailing newline added. */
  raw?: boolean;
}

interface Context {
  client: ApiClient;
  positionals: string[];
  values: OptionValues;
}

const enc = encodeURIComponent;

async function readInput(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    throw new UsageError(`cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function writeOutput(path: string, content: string | Uint8Array): Promise<void> {
  try {
    await writeFile(path, content);
  } catch (err) {
    throw new UsageError(`cannot write ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function projectsList({ client }: Context): Promise<Outcome> {
  const answer = await client.json<{ projects: ProjectRow[] }>("GET", "/projects");
  return { failed: false, data: answer, text: formatProjects(answer.projects) };
}

async function projectExport({ client, positionals: [id], values }: Context): Promise<Outcome> {
  const format = values.format === "bundle" ? "bundle" : "dbml";
  const content = await client.text(`/projects/${enc(id)}/export/${format}`);
  if (typeof values.output === "string") {
    await writeOutput(values.output, content);
    const bytes = Buffer.byteLength(content);
    return {
      failed: false,
      data: { format, file: values.output, bytes },
      text: `Wrote ${bytes} bytes to ${values.output}`,
    };
  }
  return { failed: false, data: { format, content }, text: content, raw: true };
}

/** A bundle is a JSON object; DBML and SQL cannot start with `{`. */
function looksLikeBundle(source: string): boolean {
  return source.trimStart().startsWith("{");
}

async function projectImport({ client, positionals: [id, file], values }: Context): Promise<Outcome> {
  const source = await readInput(file);
  const format = values.format ?? (looksLikeBundle(source) ? "bundle" : "dbml");
  if (format === "bundle") {
    if (values.dialect) throw new UsageError("--dialect does not apply to a bundle");
    const answer = await client.json<{ tables: number; locks: number; seeds: number; skipped: string[] }>(
      "POST",
      `/projects/${enc(id)}/import/bundle`,
      { source },
    );
    const lines = [`Imported ${answer.tables} table(s), ${answer.locks} lock(s), ${answer.seeds} seed(s).`];
    for (const skipped of answer.skipped) lines.push(`Left alone: ${skipped}`);
    return { failed: false, data: answer, text: lines.join("\n") };
  }
  const answer = await client.json<{ tables: number }>("POST", `/projects/${enc(id)}/import`, {
    source,
    ...(typeof values.dialect === "string" && { dialect: values.dialect }),
  });
  return { failed: false, data: answer, text: `Imported ${answer.tables} table(s).` };
}

async function lint({ client, positionals: [id], values }: Context): Promise<Outcome> {
  const failOn = values["fail-on"] === "warning" ? "warning" : "error";
  const report = await client.json<LintReport>("GET", `/projects/${enc(id)}/lint`);
  const failed = report.summary.error > 0 || (failOn === "warning" && report.summary.warning > 0);
  return { failed, data: { ...report, failOn, failed }, text: formatLint(report, failOn) };
}

async function driftCheck({ client, positionals: [id], values }: Context): Promise<Outcome> {
  const check = await client.json<MonitoringCheck>("POST", `/projects/${enc(id)}/monitoring/check`);
  // `result.changes` counts what this check found for the first time; a change already reported stays open in `events`.
  const stillOpen = openFindings(check).filter((event) => event.kind !== "unreachable").length;
  const unreachable = values["ignore-unreachable"] === true ? 0 : check.result.unreachable;
  const failed = check.result.changes > 0 || stillOpen > 0 || unreachable > 0;
  return { failed, data: { ...check, failed }, text: formatDrift(check) };
}

async function deployPlan({ client, positionals: [id, connId] }: Context): Promise<Outcome> {
  const plan = await client.json<DeploymentPlan>("POST", `/projects/${enc(id)}/connections/${enc(connId)}/plan`);
  // A plan the server would refuse to run is not a plan to deploy.
  const failed = plan.blockers.lintErrors > 0 || plan.blockers.waitsForStage !== null;
  return { failed, data: { ...plan, failed }, text: formatPlan(plan) };
}

async function readResolutions(path: string): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readInput(path));
  } catch (err) {
    if (err instanceof UsageError) throw err;
    throw new UsageError(`${path} is not valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UsageError(`${path} must hold a JSON object: { "column:users.legacy_code": { "strategy": "…" } }`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Sends exactly what the flags say. No risk is answered here: a resolutions file is the only way an answer
 * reaches the server, and the server's refusals (production confirmation, unresolved risks, lint, stage
 * order, review) come back as they are.
 */
async function deployRun({ client, positionals: [id, connId], values }: Context): Promise<Outcome> {
  const resolutions = typeof values.resolutions === "string" ? await readResolutions(values.resolutions) : {};
  const result = await client.json<DeployResult>("POST", `/projects/${enc(id)}/connections/${enc(connId)}/deploy`, {
    resolutions,
    ...(typeof values["confirm-name"] === "string" && { confirmName: values["confirm-name"] }),
    ...(values["no-backup"] === true && { backupBefore: false }),
  });
  return { failed: !result.success, data: result, text: formatDeploy(result) };
}

async function historyExport({ client, positionals: [id, connId], values }: Context): Promise<Outcome> {
  const format = typeof values.format === "string" ? values.format : "sql";
  const archive = await client.bytes(`/projects/${enc(id)}/connections/${enc(connId)}/history/export?format=${format}`);
  const file = values.output as string;
  await writeOutput(file, archive);
  return {
    failed: false,
    data: { format, file, bytes: archive.byteLength },
    text: `Wrote ${archive.byteLength} bytes to ${file}`,
  };
}

async function reviewsList({ client, positionals: [id] }: Context): Promise<Outcome> {
  const answer = await client.json<{ reviews: ReviewRow[] }>("GET", `/projects/${enc(id)}/reviews`);
  return { failed: false, data: answer, text: formatReviews(answer.reviews) };
}

export const HANDLERS: Record<CommandId, (context: Context) => Promise<Outcome>> = {
  "projects.list": projectsList,
  "project.export": projectExport,
  "project.import": projectImport,
  lint,
  "drift.check": driftCheck,
  "deploy.plan": deployPlan,
  "deploy.run": deployRun,
  "history.export": historyExport,
  "reviews.list": reviewsList,
};
