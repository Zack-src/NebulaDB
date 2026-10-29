import type { ApiError } from "./client.js";

/** The parts of the server's answers the text output reads; everything else is in `--json`. */
export interface ProjectRow {
  id: string;
  name: string;
  status?: string;
  permission: string;
}

export interface LintFinding {
  ruleId: string;
  severity: string;
  tableName: string;
  fieldName?: string;
  message: string;
}

export interface LintReport {
  profile: string;
  blockDeployment: boolean;
  summary: { error: number; warning: number; info: number };
  findings: LintFinding[];
}

export interface DriftEvent {
  id: string;
  connectionName: string | null;
  kind: string;
  status: string;
  added: string[];
  removed: string[];
  changed: string[];
  error: string | null;
}

export interface MonitoringCheck {
  result: { checked: number; changes: number; unreachable: number };
  events: DriftEvent[];
}

export interface PlanRisk {
  type: string;
  severity: string;
  tableName: string;
  columnName?: string;
  affectedRowCount: number;
  resolutionKey?: string;
  unmeasured?: boolean;
}

export interface DeploymentPlan {
  engine: string;
  diff: { tables?: { name: string; status: string }[] };
  risks: PlanRisk[];
  seeds?: unknown[];
  sqlPreview: string;
  blockers: { lintErrors: number; waitsForStage: string | null };
}

export interface DeployResult {
  success: boolean;
  executedStatements: number;
  backupId?: string | null;
  irreversibleWarnings?: string[];
}

export interface ReviewRow {
  id: string;
  connectionName: string;
  environment: string | null;
  status: string;
  requestedByEmail: string;
  requestedAt: string;
  expiresAt?: string;
}

/** Left-aligned columns, two spaces apart; the last column is not padded. */
export function table(headers: string[], rows: string[][]): string {
  const all = [headers, ...rows];
  const widths = headers.map((_, column) => Math.max(...all.map((row) => (row[column] ?? "").length)));
  return all
    .map((row) =>
      row
        .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column])))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function formatProjects(projects: ProjectRow[]): string {
  if (projects.length === 0) return "No projects.";
  return table(
    ["ID", "NAME", "PERMISSION"],
    projects.map((project) => [project.id, project.name, project.permission]),
  );
}

export function formatLint(report: LintReport, failOn: "error" | "warning"): string {
  const { error, warning, info } = report.summary;
  const lines = report.findings.map((finding) => {
    const where = finding.fieldName ? `${finding.tableName}.${finding.fieldName}` : finding.tableName;
    return `${finding.severity.padEnd(7)} ${where}: ${finding.message} [${finding.ruleId}]`;
  });
  lines.push(
    `${lines.length > 0 ? "\n" : ""}${plural(error, "error")}, ${plural(warning, "warning")}, ${info} info (profile ${report.profile}, failing on ${failOn})`,
  );
  return lines.join("\n");
}

/** The findings of a check that stop a pipeline: new changes, still-open ones, unreachable databases. */
export function openFindings(check: MonitoringCheck): DriftEvent[] {
  return check.events.filter((event) => event.status === "open");
}

export function formatDrift(check: MonitoringCheck): string {
  const { checked, changes, unreachable } = check.result;
  const lines = [
    `Checked ${plural(checked, "database")}: ${plural(changes, "new change")}, ${unreachable} unreachable.`,
  ];
  for (const event of openFindings(check)) {
    const name = event.connectionName ?? "(detached connection)";
    if (event.kind === "unreachable") {
      lines.push(`  unreachable: ${name}${event.error ? ` (${event.error})` : ""}`);
      continue;
    }
    const parts = [
      event.added.length > 0 && `added ${event.added.join(", ")}`,
      event.removed.length > 0 && `removed ${event.removed.join(", ")}`,
      event.changed.length > 0 && `changed ${event.changed.join(", ")}`,
    ].filter(Boolean);
    lines.push(
      `  changed outside the schema: ${name} (${event.kind})${parts.length > 0 ? `: ${parts.join("; ")}` : ""}`,
    );
  }
  return lines.join("\n");
}

/** The key a risk is answered under in a resolutions file: lower-case `table:<t>` or `column:<t>.<c>`. */
export function riskKey(risk: PlanRisk): string {
  return (
    risk.resolutionKey ?? (risk.columnName ? `column:${risk.tableName}.${risk.columnName}` : `table:${risk.tableName}`)
  ).toLowerCase();
}

/** The SQL goes last, so the verdict is not lost above a long script. */
export function formatPlan(plan: DeploymentPlan): string {
  const tables = plan.diff.tables ?? [];
  const count = (status: string) => tables.filter((entry) => entry.status === status).length;
  const lines = [
    `Engine: ${plan.engine}`,
    `Tables: ${count("added")} added, ${count("changed")} changed, ${count("removed")} removed`,
  ];

  if (plan.risks.length > 0) {
    lines.push("", "Risks (answer them in a resolutions file):");
    for (const risk of plan.risks) {
      const rows = risk.unmeasured ? "not measured" : plural(risk.affectedRowCount, "row");
      lines.push(`  ${risk.severity.padEnd(8)} ${riskKey(risk)}  ${risk.type}  ${rows}`);
    }
  }

  const blockers: string[] = [];
  if (plan.blockers.lintErrors > 0)
    blockers.push(`${plural(plan.blockers.lintErrors, "lint error")} the project refuses to deploy with`);
  if (plan.blockers.waitsForStage)
    blockers.push(`the stage "${plan.blockers.waitsForStage}" must have this schema first`);
  if (blockers.length > 0) lines.push("", ...blockers.map((blocker) => `Would be refused: ${blocker}`));

  lines.push("", plan.sqlPreview.trim() ? plan.sqlPreview.trim() : "-- nothing to deploy");
  return lines.join("\n");
}

export function formatDeploy(result: DeployResult): string {
  const lines = [`Deployed: ${plural(result.executedStatements, "statement")} executed.`];
  if (result.backupId) lines.push(`Backup: ${result.backupId}`);
  for (const warning of result.irreversibleWarnings ?? []) lines.push(`Irreversible: ${warning}`);
  return lines.join("\n");
}

export function formatReviews(reviews: ReviewRow[]): string {
  if (reviews.length === 0) return "No reviews.";
  return table(
    ["ID", "DATABASE", "STATUS", "REQUESTED BY", "REQUESTED", "EXPIRES"],
    reviews.map((review) => [
      review.id,
      review.environment ? `${review.connectionName} (${review.environment})` : review.connectionName,
      review.status,
      review.requestedByEmail,
      review.requestedAt,
      review.expiresAt ?? "",
    ]),
  );
}

/** The server's refusal as it said it: the message, its stable code, and what it listed (risks, the environment…). */
export function formatApiError(error: ApiError): string {
  const lines = [`${error.message} (${error.code})`];
  for (const [name, value] of Object.entries(error.details)) {
    if (name === "risks" && Array.isArray(value)) {
      lines.push("Risks to answer:");
      for (const risk of value as PlanRisk[]) lines.push(`  ${risk.severity.padEnd(8)} ${riskKey(risk)}  ${risk.type}`);
    } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      lines.push(`  ${name}: ${value}`);
    } else if (value !== null && value !== undefined) {
      lines.push(`  ${name}: ${JSON.stringify(value)}`);
    }
  }
  return lines.join("\n");
}
