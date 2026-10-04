import { notifyFollowers } from "../notifications/repository.js";
import type { FastifyRequest } from "fastify";
import {
  TABLE_LOCK_AUTHORITIES,
  TABLE_LOCK_LEVELS,
  TABLE_LOCK_REASON_MAX,
  getTablesMap,
  type TableLock,
  type TableLockAuthority,
  type TableLockLevel,
  type TableLocksResponse,
} from "@athanordb/shared";
import { getRoom, notifyLocksChanged } from "../../realtime/roomRegistry.js";
import { readProjectReadOnly } from "../../realtime/readOnlyProject.js";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { canOverrideLock, lockAuthorityOf } from "./access.js";
import { deleteTableLock, getTableLock, listTableLocks, upsertTableLock } from "./repository.js";

/**
 * What the lock routes do, once the caller is known to see the project — the
 * same rules for the app's routes and for `/api/v1`, which only add a scope
 * check in front.
 */
interface Caller {
  id: string;
  email: string;
  displayName: string;
}

/** The project's locks under the names the tables have now, and what the caller may do about them. */
export function listLocksFor(userId: string, projectId: string, projectName: string): TableLocksResponse {
  // Live names: a table renamed by an administrator since it was locked
  // should be listed under the name it has now.
  const names = new Map(readProjectReadOnly(projectId, projectName).tables.map((table) => [table.id, table.name]));
  return {
    locks: listTableLocks(projectId).map((lock) => ({
      ...lock,
      tableName: names.get(lock.tableId) ?? lock.tableName,
    })),
    canManage: lockAuthorityOf(userId, projectId),
  };
}

/** Places a lock, or changes the one there. `body` is what the client sent, unchecked. */
export function placeLock(
  user: Caller,
  projectId: string,
  tableId: string,
  body: unknown,
  req: FastifyRequest,
): TableLock {
  const held = lockAuthorityOf(user.id, projectId);
  if (!held) throw new ApiError("FORBIDDEN");

  const input = (body ?? {}) as { level?: unknown; authority?: unknown; reason?: unknown };
  if (!TABLE_LOCK_LEVELS.includes(input.level as TableLockLevel)) throw new ApiError("TABLE_LOCK_INVALID");
  const authority = (input.authority ?? "project") as TableLockAuthority;
  if (!TABLE_LOCK_AUTHORITIES.includes(authority)) throw new ApiError("TABLE_LOCK_INVALID");
  if (input.reason !== undefined && input.reason !== null && typeof input.reason !== "string") {
    throw new ApiError("TABLE_LOCK_INVALID");
  }
  const reason = (input.reason as string | null | undefined)?.trim().slice(0, TABLE_LOCK_REASON_MAX) || null;

  // A project administrator can neither place a lock only the instance can
  // lift, nor rewrite one — that would be a way to downgrade it.
  const existing = getTableLock(projectId, tableId);
  if (authority === "instance" && held !== "instance") throw new ApiError("TABLE_LOCK_FORBIDDEN");
  if (existing && !canOverrideLock(held, existing)) throw new ApiError("TABLE_LOCK_FORBIDDEN");

  const table = getTablesMap(getRoom(projectId).doc).get(tableId);
  if (!table) throw new ApiError("TABLE_NOT_FOUND");

  const lock = upsertTableLock({
    projectId,
    tableId,
    tableName: table.name,
    level: input.level as TableLockLevel,
    authority,
    reason,
    lockedBy: user.id,
    lockedByName: user.displayName,
  });
  auditUser(
    user,
    "table.lock",
    { type: "project", id: projectId },
    `${table.name} (${lock.level}, ${lock.authority})`,
    req,
  );
  notifyLocksChanged(projectId);
  notifyFollowers(
    projectId,
    "lock",
    { locked: true, table: table.name, level: lock.level, by: user.displayName },
    { actor: { id: user.id } },
  );
  return lock;
}

export function liftLock(user: Caller, projectId: string, tableId: string, req: FastifyRequest): void {
  const held = lockAuthorityOf(user.id, projectId);
  if (!held) throw new ApiError("FORBIDDEN");
  const existing = getTableLock(projectId, tableId);
  if (!existing) throw new ApiError("NOT_FOUND");
  if (!canOverrideLock(held, existing)) throw new ApiError("TABLE_LOCK_FORBIDDEN");

  deleteTableLock(projectId, tableId);
  auditUser(user, "table.unlock", { type: "project", id: projectId }, existing.tableName, req);
  notifyLocksChanged(projectId);
  notifyFollowers(
    projectId,
    "lock",
    { locked: false, table: existing.tableName, by: user.displayName },
    { actor: { id: user.id } },
  );
}
