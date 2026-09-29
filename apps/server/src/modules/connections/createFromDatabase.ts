import type { DatabaseConnectionConfig } from "@athanordb/shared";
import { createProjectForUser, deleteProject } from "../projects/projectCrud.js";
import { saveConnection } from "./repository.js";
import { pullConnectionSchema } from "./pull.js";

export interface CreateProjectFromDatabaseResult {
  id: string;
  name: string;
  connectionId: string;
  tablesCount: number;
}

/**
 * The "New Project from Database" entry point: creates a brand-new project,
 * attaches the given connection to it, and introspects the live schema
 * straight into its (still-empty) canvas — three existing building blocks
 * (`createProjectForUser`, `saveConnection`, `pullConnectionSchema`) chained
 * into one atomic-feeling call so the caller never sees a project that exists
 * but has no schema yet.
 *
 * `pullConnectionSchema` already treats "no existing tables" as the base
 * case for its merge (a fresh project's canvas has none), so it needs no
 * project-creation-specific variant — the empty-project case is just the
 * simplest input it already handles.
 *
 * If introspection fails (bad credentials slipped past `test`, host became
 * unreachable, schema too large, etc.), the just-created project and
 * connection are deleted rather than left behind as a dead, empty project
 * (`deleteProject` cascades to the project's connections).
 */
export async function createProjectFromDatabase(
  userId: string,
  authorDisplayName: string,
  name: string,
  connectionConfig: Omit<DatabaseConnectionConfig, "id" | "projectId">,
): Promise<CreateProjectFromDatabaseResult> {
  const project = createProjectForUser(userId, name);

  try {
    const conn = saveConnection(project.id, { ...connectionConfig, projectId: project.id });
    const result = await pullConnectionSchema(project.id, project.name, conn.id, authorDisplayName);
    return { id: project.id, name: project.name, connectionId: conn.id, tablesCount: result.tablesCount };
  } catch (err) {
    deleteProject(project.id);
    throw err;
  }
}
