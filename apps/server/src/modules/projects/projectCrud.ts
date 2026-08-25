import { ApiError } from "../../shared/errors.js";
import {
  countProjectsOwnedBy,
  deleteProjectCascade,
  insertProject,
  isProjectStatus,
  updateProjectName,
  updateProjectStatus,
  type ProjectStatus,
} from "./repository.js";
import { closeRoom } from "../../realtime/roomRegistry.js";

/**
 * Create/update/delete logic shared by the session-only
 * `routes/crud.ts` and the key-authable `/api/v1` equivalents
 * (`modules/publicApi/index.ts`) — same split as `dbmlSource.ts` and
 * `connections/deploy.ts`: one copy of the actual logic, each caller
 * supplies its own permission check, audit call, and response shape.
 */

/** Ceiling on projects owned by one account. An abuse backstop in the same spirit as the per-project entity caps in `@athanordb/shared` — generous enough that no real user meets it, low enough that a scripted loop can't fill the disk with empty projects. */
export const MAX_PROJECTS_PER_USER = 500;
export const MAX_PROJECT_NAME_LENGTH = 200;

/** Validates and normalises a submitted project name, throwing the right 400 on failure. */
export function parseProjectName(name: unknown): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) throw new ApiError("NAME_REQUIRED");
  if (trimmed.length > MAX_PROJECT_NAME_LENGTH) throw new ApiError("NAME_TOO_LONG");
  return trimmed;
}

export function createProjectForUser(userId: string, rawName: unknown): { id: string; name: string } {
  const name = parseProjectName(rawName);
  // Trashed projects still count — they are recoverable, so they still occupy the quota.
  if (countProjectsOwnedBy(userId) >= MAX_PROJECTS_PER_USER) {
    throw new ApiError("PROJECT_LIMIT_REACHED", {
      message: `you have reached the limit of ${MAX_PROJECTS_PER_USER} projects`,
      details: { limit: MAX_PROJECTS_PER_USER },
    });
  }
  const id = crypto.randomUUID();
  insertProject(id, name, userId);
  return { id, name };
}

export interface UpdateProjectInput {
  name?: unknown;
  status?: unknown;
}

/** Returns the field that actually changed (`"name"`, `"status"`, or both applied) — callers use it to decide what to audit. */
export function updateProject(id: string, input: UpdateProjectInput): { name?: string; status?: ProjectStatus } {
  if (input.name === undefined && input.status === undefined) throw new ApiError("NAME_OR_STATUS_REQUIRED");

  const result: { name?: string; status?: ProjectStatus } = {};
  if (input.name !== undefined) {
    const name = parseProjectName(input.name);
    updateProjectName(id, name);
    result.name = name;
  }
  if (input.status !== undefined) {
    if (!isProjectStatus(input.status)) throw new ApiError("PROJECT_STATUS_INVALID");
    updateProjectStatus(id, input.status);
    result.status = input.status;
  }
  return result;
}

/** Stops the in-memory room (if live) before touching its rows, so a concurrent editor can't write a revision/snapshot for an id that's about to stop existing. */
export function deleteProject(id: string): void {
  closeRoom(id);
  deleteProjectCascade(id);
}
