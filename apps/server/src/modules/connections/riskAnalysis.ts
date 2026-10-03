import type { AcceptedRisk, DatabaseEngine, MigrationResolutionMap, SchemaRisk } from "@athanordb/shared";
import { detectTypeTranslationRisks, planRiskProbes, riskFromProbe, type MigrationDiff } from "@athanordb/dbml-engine";
import { ApiError } from "../../shared/errors.js";
import type { DatabaseDriver } from "./drivers/interface.js";

/** One probe may not hold the deployment up longer than this… */
const PROBE_TIMEOUT_MS = 5_000;
/** …nor all of them together. Past it, the rest are reported unmeasured rather than run. */
const TOTAL_BUDGET_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error("probe timed out")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * What a deployment plan would do to the data already in the target:
 * dropped tables or columns that hold rows, NOT NULL over existing NULLs,
 * a shorter text limit than the longest value, a unique constraint over
 * duplicates, a foreign key over orphans, type changes — measured with
 * aggregate queries only (`planRiskProbes`), one at a time, each bounded in
 * time. A probe that fails or runs out of time is still reported, as
 * unmeasured: "could not check" must not read as "safe".
 */
export async function analyzeDeploymentRisks(
  driver: DatabaseDriver,
  diff: MigrationDiff,
  engine: DatabaseEngine,
): Promise<SchemaRisk[]> {
  const risks: SchemaRisk[] = [];
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  for (const probe of planRiskProbes(diff, engine)) {
    let value: number | null;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      value = null;
    } else {
      try {
        value = await withTimeout(driver.queryScalar(probe.sql), Math.min(PROBE_TIMEOUT_MS, remaining));
        // A MAX over an empty table is "nothing to measure", which is safe.
        if (value === null && probe.type === "LENGTH_REDUCTION") value = 0;
      } catch {
        value = null;
      }
    }
    const risk = riskFromProbe(probe, value);
    if (risk) risks.push(risk);
  }
  return [...risks, ...detectTypeTranslationRisks(diff, engine)];
}

/** The key a risk's answer is filed under in a `MigrationResolutionMap`. */
export function resolutionKeyOf(risk: SchemaRisk): string {
  if (risk.resolutionKey) return risk.resolutionKey;
  return risk.columnName
    ? `column:${risk.tableName.toLowerCase()}.${risk.columnName.toLowerCase()}`
    : `table:${risk.tableName.toLowerCase()}`;
}

/**
 * Settles a plan's risks against the resolutions sent with the deployment,
 * and refuses what must not run:
 *  - a risk whose answer is "cancel / handle manually" (also the default for
 *    a unique constraint over duplicates, a foreign key over orphans, a text
 *    limit below the longest value) stops the deployment — that option used
 *    to be offered and then ignored;
 *  - on the production stage, every critical risk needs an explicit answer:
 *    a caller that sent none (an API script) does not get the defaults.
 * Returns what was decided, for the deployment record.
 */
export function settleRisks(
  risks: SchemaRisk[],
  resolutions: MigrationResolutionMap,
  production: boolean,
): AcceptedRisk[] {
  const blocked: string[] = [];
  const unresolved: string[] = [];
  const settled: AcceptedRisk[] = [];
  for (const risk of risks) {
    if (risk.severity === "info" || risk.type === "TYPE_TRANSLATION_SUGGESTED") continue;
    const label = risk.columnName ? `${risk.tableName}.${risk.columnName}` : risk.tableName;
    const chosen = resolutions[resolutionKeyOf(risk)]?.strategy;
    const strategy = chosen ?? risk.defaultStrategy;
    if (strategy === "CANCEL") blocked.push(`${risk.type} ${label}`);
    else if (production && risk.severity === "critical" && !chosen) unresolved.push(`${risk.type} ${label}`);
    else {
      settled.push({
        type: risk.type,
        tableName: risk.tableName,
        ...(risk.columnName ? { columnName: risk.columnName } : {}),
        ...(risk.detail ? { detail: risk.detail } : {}),
        affectedRowCount: risk.affectedRowCount,
        strategy,
        ...(risk.unmeasured ? { unmeasured: true } : {}),
      });
    }
  }
  if (blocked.length > 0) throw new ApiError("DEPLOYMENT_BLOCKED_BY_RISK", { details: { risks: blocked } });
  if (unresolved.length > 0) throw new ApiError("DESTRUCTIVE_CHANGE_UNRESOLVED", { details: { risks: unresolved } });
  return settled;
}
