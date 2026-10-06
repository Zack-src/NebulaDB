import type { TableLock, TableLockAuthority } from "@nebuladb/shared";
import { fetchTableLocks } from "@/services/tableLocksApi";

/** What the canvas needs to know about locks: which tables carry one, and which of those *this user* cannot alter. */
export interface TableLocksView {
  byTable: ReadonlyMap<string, TableLock>;
  frozen: ReadonlySet<string>;
  canManage: TableLockAuthority | null;
}

export const NO_TABLE_LOCKS: TableLocksView = { byTable: new Map(), frozen: new Set(), canManage: null };

/** Mirrors the server's `canOverrideLock` — for display only; the server decides. */
export function canOverrideLock(held: TableLockAuthority | null, lock: Pick<TableLock, "authority">): boolean {
  return held === "instance" || (held === "project" && lock.authority === "project");
}

/**
 * The project's table locks, as the server last reported them.
 *
 * A mirror, never the authority: the server refuses or reverts a change to a
 * locked table whatever this says. What it buys is an editor that does not
 * *offer* such a change — no rename field, no "add column" — instead of one
 * that lets the user make it and then takes it back.
 *
 * Refetched when the project changes and whenever the server announces
 * `locks-changed` on the project's socket (see `ServerNotice`), so a padlock
 * placed by a colleague appears without a reload.
 */
export class TableLocksState {
  view = $state.raw<TableLocksView>(NO_TABLE_LOCKS);
  private requested = 0;

  constructor(private readonly projectId: () => string) {
    $effect(() => {
      this.projectId();
      this.view = NO_TABLE_LOCKS;
      void this.refresh();
    });
  }

  refresh = async (): Promise<void> => {
    const ticket = ++this.requested;
    try {
      const { locks, canManage } = await fetchTableLocks(this.projectId());
      // A slower, older answer must not overwrite a newer one.
      if (ticket !== this.requested) return;
      this.view = {
        byTable: new Map(locks.map((lock) => [lock.tableId, lock])),
        frozen: new Set(locks.filter((lock) => !canOverrideLock(canManage, lock)).map((lock) => lock.tableId)),
        canManage,
      };
    } catch {
      // Offline, or the perf harness (no server): the last known state stands,
      // and the server still enforces whatever is really locked.
    }
  };
}
