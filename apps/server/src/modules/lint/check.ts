import { lintProject, summarizeLint, type LintSettings } from "@nebuladb/dbml-engine";
import type { Project } from "@nebuladb/shared";
import { readProjectReadOnly } from "../../realtime/readOnlyProject.js";
import { ApiError } from "../../shared/errors.js";
import { resolveProjectLint } from "./repository.js";

/** Findings named in a refused deployment — enough to see what is wrong, not a second report. */
const MAX_REPORTED = 20;

/** What the linter says about a project as it is stored now. */
export function lintReport(projectId: string, projectName: string) {
  const { settings, source } = resolveProjectLint(projectId);
  const findings = lintProject(readProjectReadOnly(projectId, projectName), settings);
  return {
    profile: settings.profile,
    source,
    blockDeployment: settings.blockDeployment,
    summary: summarizeLint(findings),
    findings,
  };
}

/**
 * The findings that stand between a project and a deployment: those of level
 * `error`, when the project asked for them to block. `findings` is capped;
 * `count` is not.
 */
export function blockingLintFindings(project: Project, settings: LintSettings) {
  const errors = settings.blockDeployment
    ? lintProject(project, settings).filter((finding) => finding.severity === "error")
    : [];
  return {
    count: errors.length,
    findings: errors.slice(0, MAX_REPORTED).map((finding) => ({
      ruleId: finding.ruleId,
      tableName: finding.tableName,
      fieldName: finding.fieldName,
      message: finding.message,
      params: finding.params,
    })),
  };
}

/**
 * Refuses a deployment while the schema has a finding of level `error`, when
 * the project asked for that. Checked on the server, on the schema about to
 * be deployed: the editor's problems panel only mirrors it.
 */
export function assertLintAllowsDeployment(project: Project, settings: LintSettings): void {
  const blocking = blockingLintFindings(project, settings);
  if (blocking.count === 0) return;
  throw new ApiError("LINT_BLOCKS_DEPLOYMENT", { details: blocking });
}
