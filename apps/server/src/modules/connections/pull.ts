import { readProjectFromDoc, writeProjectToDoc } from "@athanordb/shared";
import { ApiError } from "../../shared/errors.js";
import { getRoom } from "../../realtime/roomRegistry.js";
import { createDatabaseDriver } from "./drivers/index.js";
import { getConnectionById } from "./repository.js";

export interface PullSchemaResult {
  pulled: boolean;
  tablesCount: number;
}

/**
 * Introspects a connection's live database and merges its schema into the
 * project's canvas doc, preserving existing tables' ids/positions/styles by
 * name match — factored out of the session-authed `.../pull` route the same
 * way `deployToConnection` was, so `/api/v1` runs the identical merge.
 */
export async function pullConnectionSchema(
  projectId: string,
  projectName: string,
  connId: string,
  authorDisplayName: string,
): Promise<PullSchemaResult> {
  const conn = getConnectionById(connId);
  if (!conn) throw new ApiError("CONNECTION_NOT_FOUND");

  const driver = await createDatabaseDriver(conn);
  try {
    const liveProject = await driver.introspectSchema();
    const room = getRoom(projectId);
    const current = readProjectFromDoc(room.doc, projectId, projectName);

    const existingTablesByName = new Map(current.tables.map((t) => [t.name.toLowerCase(), t]));
    const tables = liveProject.tables.map((table) => {
      const prev = existingTablesByName.get(table.name.toLowerCase());
      return {
        ...table,
        id: prev?.id ?? crypto.randomUUID(),
        position: prev?.position ?? table.position,
        size: prev?.size,
        style: prev?.style,
        detailLevel: prev?.detailLevel ?? "standard",
      };
    });

    const updatedProject = { ...current, tables, refs: liveProject.refs };
    room.doc.transact(() => writeProjectToDoc(room.doc, updatedProject), authorDisplayName);

    return { pulled: true, tablesCount: tables.length };
  } finally {
    await driver.close().catch(() => {});
  }
}
