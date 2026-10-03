import type { FastifyInstance } from "fastify";
import {
  TABLE_LOCK_AUTHORITIES,
  TABLE_LOCK_LEVELS,
  TABLE_LOCK_REASON_MAX,
  getTablesMap,
  type TableLockAuthority,
  type TableLockLevel,
  type TableLocksResponse,
} from "@athanordb/shared";
import { getRoom, notifyLocksChanged } from "../../realtime/roomRegistry.js";
import { readProjectReadOnly } from "../../realtime/readOnlyProject.js";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireProjectAccess } from "../../shared/guards.js";
import { canOverrideLock, lockAuthorityOf } from "./access.js";
import { deleteTableLock, getTableLock, listTableLocks, upsertTableLock } from "./repository.js";

/**
 * Table locks: an administrator freezes a table's structure; everyone else
 * keeps reading it and can still move it around the canvas.
 *
 * These routes only record *who locked what*. Enforcement lives on the write
 * paths themselves (`access.ts#assertLocksAllow` for REST, `Room` for
 * realtime), because a lock that only the lock routes know about protects
 * nothing.
 */
export function registerTableLockRoutes(app: FastifyInstance): void {
  // Readable by anyone who can open the project: the padlock and its reason
  // are what tell a collaborator why a table will not let itself be edited.
  app.get("/api/projects/:id/locks", async (req): Promise<TableLocksResponse> => {
    const { id } = req.params as { id: string };
    const { user, project } = requireProjectAccess(req, id, "view");
    // Live names: a table renamed by an administrator since it was locked
    // should be listed under the name it has now.
    const names = new Map(readProjectReadOnly(id, project.name).tables.map((table) => [table.id, table.name]));
    return {
      locks: listTableLocks(id).map((lock) => ({ ...lock, tableName: names.get(lock.tableId) ?? lock.tableName })),
      canManage: lockAuthorityOf(user.id, id),
    };
  });

  app.put("/api/projects/:id/locks/:tableId", async (req) => {
    const { id, tableId } = req.params as { id: string; tableId: string };
    const { user } = requireProjectAccess(req, id, "view");
    const held = lockAuthorityOf(user.id, id);
    if (!held) throw new ApiError("FORBIDDEN");

    const body = (req.body ?? {}) as { level?: unknown; authority?: unknown; reason?: unknown };
    if (!TABLE_LOCK_LEVELS.includes(body.level as TableLockLevel)) throw new ApiError("TABLE_LOCK_INVALID");
    const authority = (body.authority ?? "project") as TableLockAuthority;
    if (!TABLE_LOCK_AUTHORITIES.includes(authority)) throw new ApiError("TABLE_LOCK_INVALID");
    if (body.reason !== undefined && body.reason !== null && typeof body.reason !== "string") {
      throw new ApiError("TABLE_LOCK_INVALID");
    }
    const reason = (body.reason as string | null | undefined)?.trim().slice(0, TABLE_LOCK_REASON_MAX) || null;

    // A project administrator can neither place a lock only the instance can
    // lift, nor rewrite one — that would be a way to downgrade it.
    const existing = getTableLock(id, tableId);
    if (authority === "instance" && held !== "instance") throw new ApiError("TABLE_LOCK_FORBIDDEN");
    if (existing && !canOverrideLock(held, existing)) throw new ApiError("TABLE_LOCK_FORBIDDEN");

    const table = getTablesMap(getRoom(id).doc).get(tableId);
    if (!table) throw new ApiError("TABLE_NOT_FOUND");

    const lock = upsertTableLock({
      projectId: id,
      tableId,
      tableName: table.name,
      level: body.level as TableLockLevel,
      authority,
      reason,
      lockedBy: user.id,
      lockedByName: user.displayName,
    });
    auditUser(user, "table.lock", { type: "project", id }, `${table.name} (${lock.level}, ${lock.authority})`, req);
    notifyLocksChanged(id);
    return lock;
  });

  app.delete("/api/projects/:id/locks/:tableId", async (req) => {
    const { id, tableId } = req.params as { id: string; tableId: string };
    const { user } = requireProjectAccess(req, id, "view");
    const held = lockAuthorityOf(user.id, id);
    if (!held) throw new ApiError("FORBIDDEN");
    const existing = getTableLock(id, tableId);
    if (!existing) throw new ApiError("NOT_FOUND");
    if (!canOverrideLock(held, existing)) throw new ApiError("TABLE_LOCK_FORBIDDEN");

    deleteTableLock(id, tableId);
    auditUser(user, "table.unlock", { type: "project", id }, existing.tableName, req);
    notifyLocksChanged(id);
    return { unlocked: true };
  });
}
