/** Where in the script a refused migration stopped, as far as the engine's own words and the statement say. */
export interface DeploymentFailure {
  /** 1-based position of the statement, and how many the script has. */
  index: number;
  total: number;
  statement: string;
  /** The database's reason, without the "statement N of M failed:" the driver put in front. */
  reason: string;
  table?: string;
  column?: string;
}

const QUOTED = /[`"[]([^`"\]]+)[`"\]]/;
const TABLE_OF = /(?:ALTER|CREATE|DROP)\s+TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?[`"[]?([^`"\]\s(]+)[`"\]]?/i;
const INDEX_ON = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+.*?\sON\s+[`"[]?([^`"\]\s(]+)[`"\]]?/is;
const COLUMN_OF = /(?:ADD|ALTER|DROP|MODIFY)\s+(?:COLUMN\s+)?(?:IF\s+(?:NOT\s+)?EXISTS\s+)?[`"[]?([^`"\]\s]+)[`"\]]?/i;

/** The failure a `MIGRATION_FAILED` answer carries in its details; `null` when it names no statement. */
export function parseDeploymentFailure(details: Record<string, unknown>): DeploymentFailure | null {
  const statement = details.failedStatement;
  const index = details.failedIndex;
  if (typeof statement !== "string" || typeof index !== "number") return null;
  const error = typeof details.error === "string" ? details.error : "";
  const reason = error.replace(/^statement \d+ of \d+ failed:\s*/, "");
  const total = typeof details.failedTotal === "number" ? details.failedTotal : index;
  const table = TABLE_OF.exec(statement)?.[1] ?? INDEX_ON.exec(statement)?.[1];
  const column = columnOf(statement, reason);
  return { index, total, statement, reason, ...(table ? { table } : {}), ...(column ? { column } : {}) };
}

/** The column the statement is about: the one on the line the engine points at ("at [5:35]"), else the one an ALTER names. */
function columnOf(statement: string, reason: string): string | undefined {
  const position = /\bat \[(\d+):(\d+)\]/.exec(reason);
  if (position) {
    const line = statement.split("\n")[Number(position[1]) - 1];
    const named = line ? QUOTED.exec(line)?.[1] : undefined;
    if (named) return named;
  }
  if (/^\s*ALTER\s+TABLE/i.test(statement)) {
    return COLUMN_OF.exec(statement.replace(/^\s*ALTER\s+TABLE\s+\S+\s+/i, ""))?.[1];
  }
  return undefined;
}
