import { writeProjectToDoc } from "@athanordb/shared";
import { isProjectTemplateId, projectFromTemplate } from "@athanordb/dbml-engine";
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
import { closeRoom, getRoom } from "../../realtime/roomRegistry.js";
import { forgetProjectIndex } from "../search/searchIndex.js";

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

export interface CreateProjectOptions {
  /** Optional starter schema id (see `PROJECT_TEMPLATES`); absent means an empty project. */
  template?: unknown;
  /** Recorded as the seeding transaction's origin, the same way an import is attributed. */
  author?: string;
}

export function createProjectForUser(
  userId: string,
  rawName: unknown,
  options: CreateProjectOptions = {},
): { id: string; name: string } {
  const name = parseProjectName(rawName);
  // Validated before the insert, so an unknown template id never leaves an empty project behind.
  const template = options.template ?? undefined;
  if (template !== undefined && !isProjectTemplateId(template)) throw new ApiError("PROJECT_TEMPLATE_INVALID");
  // Trashed projects still count — they are recoverable, so they still occupy the quota.
  if (countProjectsOwnedBy(userId) >= MAX_PROJECTS_PER_USER) {
    throw new ApiError("PROJECT_LIMIT_REACHED", {
      message: `you have reached the limit of ${MAX_PROJECTS_PER_USER} projects`,
      details: { limit: MAX_PROJECTS_PER_USER },
    });
  }
  const id = crypto.randomUUID();
  insertProject(id, name, userId);

  if (template !== undefined) {
    // Same path as a DBML import into an empty project, just with a source the
    // server owns — the templates have their own parse/validate tests, so this
    // can't fail on user input.
    const seeded = projectFromTemplate(template, id, name);
    const room = getRoom(id);
    room.doc.transact(() => writeProjectToDoc(room.doc, seeded), options.author ?? "template");
    room.flush();
  }
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
  forgetProjectIndex(id);
}
