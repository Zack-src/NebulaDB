import type { Project } from "@athanordb/shared";

// Own module with zero `@dbml/core` import, same reasoning as diff.ts — safe
// to use client-side without dragging the parser library into the bundle.

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: ValidationSeverity;
  message: string;
  tableId?: string;
  refId?: string;
}

/** `decimal(10,2)` -> `decimal`, `varchar[]` -> `varchar` — settings/precision differing across a ref's two sides isn't a modeling mistake, an outright different base type usually is. */
function baseType(type: string): string {
  return type
    .replace(/\(.*$/, "")
    .replace(/\[\]$/, "")
    .trim()
    .toLowerCase();
}

function findDuplicateNames<T>(items: T[], nameOf: (item: T) => string): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const name = nameOf(item);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name);
}

/** Directed-graph cycle detection (DFS, white/gray/black) over ref.from -> ref.to, one cycle reported per distinct back-edge found. Self-loops (a table referencing itself, e.g. `employees.manager_id -> employees.id`) are excluded by the caller — they're a common, valid pattern, not a modeling mistake. */
function findCycles(adjacency: Map<string, string[]>): string[][] {
  const UNVISITED = 0;
  const IN_PROGRESS = 1;
  const DONE = 2;
  const state = new Map<string, number>();
  for (const id of adjacency.keys()) state.set(id, UNVISITED);

  const cycles: string[][] = [];
  const stack: string[] = [];

  function visit(node: string): void {
    state.set(node, IN_PROGRESS);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      if (state.get(next) === IN_PROGRESS) {
        const idx = stack.indexOf(next);
        cycles.push([...stack.slice(idx), next]);
      } else if (state.get(next) === UNVISITED) {
        visit(next);
      }
    }
    stack.pop();
    state.set(node, DONE);
  }

  for (const id of adjacency.keys()) {
    if (state.get(id) === UNVISITED) visit(id);
  }
  return cycles;
}

/**
 * Structural validation of a `Project`: duplicate table/field names, tables
 * with no primary key, ref endpoints that don't resolve to a real
 * table+field ("missing FK target"), a ref whose two sides have different
 * base column types, and circular ref chains among 2+ distinct tables.
 * Informational only —
 * nothing here blocks import or editing, since a schema mid-edit or one with
 * an intentional circular dependency (e.g. a bidirectional hub) is still a
 * valid thing to have open; SQL export already emits FKs as separate `ALTER
 * TABLE` statements after all `CREATE TABLE`s, so a cycle doesn't actually
 * break generation, it's just usually worth a human's attention.
 */
export function validateProject(project: Project): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const tablesById = new Map(project.tables.map((t) => [t.id, t]));

  for (const name of findDuplicateNames(project.tables, (t) => t.name)) {
    issues.push({ severity: "error", message: `Duplicate table name "${name}"` });
  }

  for (const table of project.tables) {
    for (const name of findDuplicateNames(table.fields, (f) => f.name)) {
      issues.push({
        severity: "error",
        message: `Duplicate field name "${name}" in table "${table.name}"`,
        tableId: table.id,
      });
    }

    // A composite PK is expressed as an `indexes { (a, b) [pk] }` entry, not a
    // per-field flag (DBML/SQL have no other way to say it) — either counts.
    const hasPk = table.fields.some((f) => f.pk) || table.indexes.some((idx) => idx.pk);
    if (!hasPk) {
      issues.push({ severity: "warning", message: `Table "${table.name}" has no primary key`, tableId: table.id });
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const table of project.tables) adjacency.set(table.id, []);

  for (const ref of project.refs) {
    const fromTable = tablesById.get(ref.from.tableId);
    const toTable = tablesById.get(ref.to.tableId);
    const label = ref.name ? `"${ref.name}"` : ref.id;

    if (!fromTable) {
      issues.push({ severity: "error", message: `Ref ${label}: source table not found`, refId: ref.id });
    } else if (!fromTable.fields.some((f) => f.id === ref.from.fieldId)) {
      issues.push({
        severity: "error",
        message: `Ref ${label}: source field not found in "${fromTable.name}"`,
        refId: ref.id,
      });
    }

    if (!toTable) {
      issues.push({ severity: "error", message: `Ref ${label}: target table not found`, refId: ref.id });
    } else if (!toTable.fields.some((f) => f.id === ref.to.fieldId)) {
      issues.push({
        severity: "error",
        message: `Ref ${label}: target field not found in "${toTable.name}"`,
        refId: ref.id,
      });
    }

    if (fromTable && toTable && ref.from.tableId !== ref.to.tableId) {
      adjacency.get(ref.from.tableId)?.push(ref.to.tableId);
    }

    const fromField = fromTable?.fields.find((f) => f.id === ref.from.fieldId);
    const toField = toTable?.fields.find((f) => f.id === ref.to.fieldId);
    if (fromField && toField && baseType(fromField.type) !== baseType(toField.type)) {
      issues.push({
        severity: "warning",
        message: `Ref ${label}: type mismatch — "${fromTable!.name}.${fromField.name}" is ${fromField.type}, "${toTable!.name}.${toField.name}" is ${toField.type}`,
        refId: ref.id,
      });
    }
  }

  const seenCycleKeys = new Set<string>();
  for (const cycle of findCycles(adjacency)) {
    const names = cycle.map((id) => tablesById.get(id)?.name ?? id);
    const key = [...new Set(cycle)].sort().join(",");
    if (seenCycleKeys.has(key)) continue;
    seenCycleKeys.add(key);
    issues.push({ severity: "warning", message: `Circular reference: ${names.join(" -> ")}` });
  }

  return issues;
}
