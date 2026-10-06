import { hasVariables, resolveVariables } from "@nebuladb/dbml-engine";
import { stageVariables } from "../environments/variables.js";
import { readProjectFromDoc, writeProjectToDoc } from "@nebuladb/shared";
import { ApiError } from "../../shared/errors.js";
import { getRoom } from "../../realtime/roomRegistry.js";
import { createDatabaseDriver } from "./drivers/index.js";
import { assertLocksAllow } from "../tableLocks/access.js";
import { saveReferenceFingerprint } from "./drift.js";
import { getProjectConnection } from "./repository.js";

export interface PullSchemaResult {
  pulled: boolean;
  tablesCount: number;
}

/**
 * Introspects a connection's live database and merges its schema into the
 * project's canvas doc, preserving existing tables' ids/positions/styles by
 * name match — factored out of the session-authed `.../pull` route the same
 * way `deployToConnection` was, so `/api/v1` runs the identical merge.
 *
 * `actingUserId` is who the table locks are checked against; omitted only for
 * a project created a moment ago, which cannot have any.
 */
export async function pullConnectionSchema(
  projectId: string,
  projectName: string,
  connId: string,
  authorDisplayName: string,
  actingUserId?: string,
): Promise<PullSchemaResult> {
  const conn = getProjectConnection(projectId, connId);
  if (!conn) throw new ApiError("CONNECTION_NOT_FOUND");

  const driver = await createDatabaseDriver(conn);
  try {
    const liveProject = await driver.introspectSchema();
    const room = getRoom(projectId);
    const current = readProjectFromDoc(room.doc, projectId, projectName);

    // A table whose name holds `{{variables}}` is found under the name this
    // stage gives it — and keeps its placeholders, or one pull from one stage
    // would turn the shared schema into that stage's.
    const named = resolveVariables(current, stageVariables(conn.environmentId)).project.tables;
    const existingTablesByName = new Map(current.tables.map((t, i) => [named[i].name.toLowerCase(), t]));
    const templated = (t: { name: string; schemaName?: string }) =>
      hasVariables(t.name) || hasVariables(t.schemaName ?? "");
    // Introspection ids a table by its name; the project ids it by a stable
    // uuid. Relations have to follow the table to the id it ends up with, or
    // they point at nothing.
    const tableIds = new Map<string, string>();
    const tables = liveProject.tables.map((table) => {
      const prev = existingTablesByName.get(table.name.toLowerCase());
      const id = prev?.id ?? crypto.randomUUID();
      tableIds.set(table.id, id);
      return {
        ...table,
        ...(prev && templated(prev) ? { name: prev.name, schemaName: prev.schemaName } : {}),
        id,
        position: prev?.position ?? table.position,
        size: prev?.size,
        style: prev?.style,
        detailLevel: prev?.detailLevel ?? "standard",
      };
    });

    const refs = liveProject.refs.map((ref) => ({
      ...ref,
      from: { ...ref.from, tableId: tableIds.get(ref.from.tableId) ?? ref.from.tableId },
      to: { ...ref.to, tableId: tableIds.get(ref.to.tableId) ?? ref.to.tableId },
    }));

    const updatedProject = { ...current, tables, refs };
    if (actingUserId) assertLocksAllow(actingUserId, projectId, current, updatedProject);
    room.doc.transact(() => writeProjectToDoc(room.doc, updatedProject), authorDisplayName);
    // The schema was just made to match the database: that is the new reference.
    saveReferenceFingerprint(projectId, connId, liveProject, "pull");

    return { pulled: true, tablesCount: tables.length };
  } finally {
    await driver.close().catch(() => {});
  }
}
