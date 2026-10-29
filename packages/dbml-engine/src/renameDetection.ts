import type { MigrationResolutionMap, SchemaRisk } from "@nebuladb/shared";
import type { MigrationDiff, MigrationFieldChange, MigrationTableChange } from "./migrationDiff.js";
import { typesMatch } from "./migrationDiff.js";
import type { MigrationDialect } from "./migrationGenerator.js";
import { q } from "./migrationGenerator.js";

/**
 * A column that disappears while a column of the same type appears in the same table is, more often than not,
 * the same column under a new name (`id_analyse` → `id_analyze`, `creation_date` → `date_creation`). The diff
 * cannot tell: it reads a drop and an add, which loses the column's data. This finds those pairs, so the plan can
 * offer `ALTER TABLE … RENAME COLUMN` instead.
 */

/** Where the answer to a rename suggestion goes in the resolutions. */
export function renameResolutionKey(table: string, from: string, to: string): string {
  return `rename:${table.toLowerCase()}.${from.toLowerCase()}->${to.toLowerCase()}`;
}

const tokensOf = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[_\W]+/)
    .filter(Boolean)
    .sort()
    .join("_");

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length]!;
}

/** How close two column names are, lower is closer; `null` when they are not close enough to be one column. */
function nameDistance(from: string, to: string): number | null {
  const a = from.toLowerCase();
  const b = to.toLowerCase();
  if (a === b) return null;
  // The same words in another order: `creation_date` and `date_creation`.
  if (tokensOf(a) === tokensOf(b)) return 0;
  const distance = editDistance(a, b);
  // A typo, or one letter of a spelling (`analyse` / `analyze`): at most one edit in five, never a short name.
  return Math.min(a.length, b.length) >= 5 && distance <= Math.max(1, Math.floor(Math.min(a.length, b.length) / 5))
    ? distance
    : null;
}

interface RenamePair {
  table: MigrationTableChange;
  from: MigrationFieldChange;
  to: MigrationFieldChange;
}

/** Same type, same nullability, same place in the key: a rename keeps the column as it is. */
function sameColumn(from: MigrationFieldChange, to: MigrationFieldChange): boolean {
  const before = from.before;
  const after = to.after;
  if (!before || !after) return false;
  return (
    typesMatch(before.type, after.type) && Boolean(before.notNull) === Boolean(after.notNull) && Boolean(before.pk) === Boolean(after.pk)
  );
}

function candidatePairs(diff: MigrationDiff): RenamePair[] {
  const pairs: RenamePair[] = [];
  for (const table of diff.tables) {
    if (table.status !== "modified") continue;
    const dropped = table.fields.filter((f) => f.status === "dropped");
    const added = table.fields.filter((f) => f.status === "added");
    const scored: { distance: number; from: MigrationFieldChange; to: MigrationFieldChange }[] = [];
    for (const from of dropped) {
      for (const to of added) {
        const distance = nameDistance(from.name, to.name);
        if (distance !== null && sameColumn(from, to)) scored.push({ distance, from, to });
      }
    }
    // Closest first; a column joins one pair only.
    scored.sort((x, y) => x.distance - y.distance);
    const usedFrom = new Set<string>();
    const usedTo = new Set<string>();
    for (const { from, to } of scored) {
      if (usedFrom.has(from.name) || usedTo.has(to.name)) continue;
      usedFrom.add(from.name);
      usedTo.add(to.name);
      pairs.push({ table, from, to });
    }
  }
  return pairs;
}

/** One `RENAME_COLUMN_SUGGESTED` risk per pair of a dropped and an added column that look like one column renamed. */
export function detectRenameCandidates(diff: MigrationDiff): SchemaRisk[] {
  return candidatePairs(diff).map(({ table, from, to }) => ({
    id: `risk-rename-${table.name}-${from.name}`,
    type: "RENAME_COLUMN_SUGGESTED",
    severity: "warning",
    tableName: table.name,
    columnName: from.name,
    detail: to.name,
    resolutionKey: renameResolutionKey(table.name, from.name, to.name),
    affectedRowCount: 0,
    availableStrategies: [
      {
        key: "RENAME_COLUMN",
        labelKey: "connections.strategy.renameColumn",
        descriptionKey: "connections.strategy.renameColumnDesc",
      },
      {
        key: "KEEP_SEPARATE",
        labelKey: "connections.strategy.keepSeparate",
        descriptionKey: "connections.strategy.keepSeparateDesc",
      },
    ],
    defaultStrategy: "RENAME_COLUMN",
    selectedStrategy: "RENAME_COLUMN",
  }));
}

/**
 * The renames the answers settle on, per table: the pairs the diff still has and whose answer is "rename"
 * (an unanswered suggestion is a rename: it keeps the data). Lower-case table name → pairs of column names.
 */
export function chosenRenames(
  diff: MigrationDiff,
  resolutions: MigrationResolutionMap,
): Map<string, { from: string; to: string }[]> {
  const chosen = new Map<string, { from: string; to: string }[]>();
  for (const { table, from, to } of candidatePairs(diff)) {
    const answer = resolutions[renameResolutionKey(table.name, from.name, to.name)]?.strategy;
    if (answer !== undefined && answer !== "RENAME_COLUMN") continue;
    const key = table.name.toLowerCase();
    chosen.set(key, [...(chosen.get(key) ?? []), { from: from.name, to: to.name }]);
  }
  return chosen;
}

/** The statement that renames a column, in the dialect's own words. */
export function renameColumnStatement(table: string, from: string, to: string, dialect: MigrationDialect): string {
  if (dialect === "mssql") {
    const literal = (text: string) => `'${text.replace(/'/g, "''")}'`;
    return `EXEC sp_rename ${literal(`${table}.${from}`)}, ${literal(to)}, 'COLUMN';`;
  }
  return `ALTER TABLE ${q(table, dialect)} RENAME COLUMN ${q(from, dialect)} TO ${q(to, dialect)};`;
}

/**
 * The risks a chosen rename makes moot: the drop of the old column (it is renamed, not dropped). They are
 * left out of what has to be answered, and of what counts as data loss.
 */
export function supersededByRename(risks: SchemaRisk[], resolutions: MigrationResolutionMap): Set<string> {
  const superseded = new Set<string>();
  for (const rename of risks) {
    if (rename.type !== "RENAME_COLUMN_SUGGESTED" || !rename.resolutionKey) continue;
    const answer = resolutions[rename.resolutionKey]?.strategy ?? rename.defaultStrategy;
    if (answer !== "RENAME_COLUMN") continue;
    for (const risk of risks) {
      if (
        risk.type === "DROP_COLUMN_WITH_DATA" &&
        risk.tableName.toLowerCase() === rename.tableName.toLowerCase() &&
        risk.columnName?.toLowerCase() === rename.columnName?.toLowerCase()
      ) {
        superseded.add(risk.id);
      }
    }
  }
  return superseded;
}
