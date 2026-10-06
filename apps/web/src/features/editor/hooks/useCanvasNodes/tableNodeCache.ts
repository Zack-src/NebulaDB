import type { Table, TableLock, TableSeedSummary } from "@nebuladb/shared";
import type { TableNodeType } from "@/features/editor/nodes/nodeTypes";
import { setsEqual } from "@/utils/setsEqual";

/**
 * Reuses the previous node object for every table whose inputs are unchanged. The Yjs layer
 * hands back a whole new `Project` on every doc update, and rebuilding each table's `data`
 * (fifteen closures) at 500 tables is ~7500 allocations for a one-column edit.
 *
 * Compared: the Yjs-stable `table` by reference, `refFieldIds` by content, and the rest
 * (palette, permissions, the table's slice of the field selection, callbacks) by reference.
 */
export interface TableNodeCacheEntry {
  node: TableNodeType;
  table: Table;
  refFieldIds: Set<string>;
  selectedFieldId: string | null;
  palette: string[];
  canWrite: boolean;
  /** The lock object itself: the lock list is refetched as a whole, so a changed lock is a new object. */
  lock: TableLock | undefined;
  /** Whether that lock binds this user, and whether they may manage it — both follow the user's authority, not the lock alone. */
  structureLocked: boolean;
  canManageLock: boolean;
  /** Whether "view data" is offered — it follows the session and the connection, not the table. */
  canViewData: boolean;
  /** The seed summary itself: the list is refetched as a whole, so a changed seed is a new object. */
  seed: TableSeedSummary | undefined;
  user: string;
  /** Identity of the callback bundle the node's data closes over. */
  callbacks: unknown;
  /** This table's validation issues, joined into one comparable string — see `buildTableNodes`. */
  issuesKey: string;
  showValidationIssues: boolean;
  /** `refId:onDelete:onUpdate` for every ref where this table is the FK side, joined — see `buildTableNodes`. */
  refActionsKey: string;
}

export type TableNodeCache = Map<string, TableNodeCacheEntry>;

export function readCachedTableNode(
  cache: TableNodeCache,
  key: Omit<TableNodeCacheEntry, "node">,
  tableId: string,
): TableNodeType | null {
  const cached = cache.get(tableId);
  if (!cached) return null;
  const unchanged =
    cached.table === key.table &&
    cached.selectedFieldId === key.selectedFieldId &&
    cached.palette === key.palette &&
    cached.canWrite === key.canWrite &&
    cached.lock === key.lock &&
    cached.structureLocked === key.structureLocked &&
    cached.canManageLock === key.canManageLock &&
    cached.canViewData === key.canViewData &&
    cached.seed === key.seed &&
    cached.user === key.user &&
    cached.callbacks === key.callbacks &&
    cached.issuesKey === key.issuesKey &&
    cached.showValidationIssues === key.showValidationIssues &&
    cached.refActionsKey === key.refActionsKey &&
    setsEqual(cached.refFieldIds, key.refFieldIds);
  return unchanged ? cached.node : null;
}
