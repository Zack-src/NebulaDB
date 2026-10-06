import { findLockViolations, type LockableSchema, type TableLock, type TableLockAuthority } from "@nebuladb/shared";
import { ApiError } from "../../shared/errors.js";
import { getEffectivePermission, isGlobalAdmin } from "../../shared/permissions.js";
import { listTableLocks, projectHasTableLocks } from "./repository.js";

/**
 * The permission `table.lock.manage`, resolved for one user on one project.
 *
 * `instance` for an instance administrator, `project` for a project
 * administrator (its owner, or a member of a team granted `administrator`),
 * `null` for everyone else — who can read the locks and nothing more.
 */
export function lockAuthorityOf(userId: string, projectId: string): TableLockAuthority | null {
  if (isGlobalAdmin(userId)) return "instance";
  return getEffectivePermission(userId, projectId) === "administrator" ? "project" : null;
}

/** Whether someone holding `held` may change a table under `lock`, or the lock itself. */
export function canOverrideLock(held: TableLockAuthority | null, lock: Pick<TableLock, "authority">): boolean {
  if (held === "instance") return true;
  return held === "project" && lock.authority === "project";
}

/**
 * The tables this user must leave structurally untouched: every locked table
 * of the project, minus those their authority lets them change.
 */
export function lockedTableIdsFor(userId: string, projectId: string): Set<string> {
  if (!projectHasTableLocks(projectId)) return new Set();
  const held = lockAuthorityOf(userId, projectId);
  if (held === "instance") return new Set();
  return new Set(
    listTableLocks(projectId)
      .filter((lock) => !canOverrideLock(held, lock))
      .map((lock) => lock.tableId),
  );
}

/**
 * Refuses a write that would alter a table locked against this user.
 *
 * The whole change is refused, never applied in part: an import that renames
 * three tables and drops a locked one would otherwise leave the project in a
 * state nobody asked for. The response lists every table in cause, so the
 * caller can fix the change in one go.
 */
export function assertLocksAllow(
  userId: string,
  projectId: string,
  before: LockableSchema,
  after: LockableSchema,
): void {
  const locked = lockedTableIdsFor(userId, projectId);
  if (locked.size === 0) return;
  const violations = findLockViolations(before, after, locked);
  if (violations.length === 0) return;
  const names = violations.map((violation) => violation.tableName);
  throw new ApiError("TABLE_LOCKED", {
    message: `locked table(s) cannot be changed: ${names.join(", ")}`,
    details: { tables: names },
  });
}
