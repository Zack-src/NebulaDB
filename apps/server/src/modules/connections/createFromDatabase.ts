import type { DatabaseConnectionConfig } from "@nebuladb/shared";
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
 * "New Project from Database": creates a project, attaches the connection and introspects
 * the live schema into its empty canvas. If introspection fails, the project and connection
 * are deleted rather than left behind empty.
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
