import crypto from "node:crypto";
import type { ProjectFolder } from "@nebuladb/shared";
import { db } from "../../infrastructure/db.js";
import { ApiError } from "../../shared/errors.js";

/**
 * Folders the project list is sorted into. One tree for the whole instance:
 * a folder named after a client is shared knowledge, like the projects in it.
 * Each person still only sees the folders that lead to a project they can
 * open, the ones they made, and — for an instance administrator — all.
 */

const MAX_NAME = 120;
const MAX_DEPTH = 5;
const MAX_FOLDERS = 1000;

interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
  created_by: string | null;
  created_at: string;
}

const toFolder = (row: FolderRow): ProjectFolder => ({
  id: row.id,
  name: row.name,
  parentId: row.parent_id,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

async function allFolders(): Promise<FolderRow[]> {
  return (await db.prepare("SELECT * FROM project_folders ORDER BY name").all()) as FolderRow[];
}

export async function getFolder(id: string): Promise<ProjectFolder | null> {
  const row = (await db.prepare("SELECT * FROM project_folders WHERE id = ?").get(id)) as FolderRow | undefined;
  return row ? toFolder(row) : null;
}

/** The folders one person sees: those leading to the projects given (the ones they can open), their own, or all. */
export async function listVisibleFolders(
  user: { id: string; isAdmin: boolean },
  visibleProjectFolders: readonly (string | null)[],
): Promise<ProjectFolder[]> {
  const rows = await allFolders();
  if (user.isAdmin) return rows.map(toFolder);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const shown = new Set<string>();
  const climb = (id: string | null) => {
    for (let at = id; at && !shown.has(at); at = byId.get(at)?.parent_id ?? null) shown.add(at);
  };
  for (const folderId of visibleProjectFolders) climb(folderId);
  for (const row of rows) if (row.created_by === user.id) climb(row.id);
  return rows.filter((row) => shown.has(row.id)).map(toFolder);
}

function parseName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) throw new ApiError("NAME_REQUIRED");
  if (name.length > MAX_NAME) throw new ApiError("NAME_TOO_LONG");
  return name;
}

/** The chain from a folder up to the top, the folder first. */
async function ancestry(id: string): Promise<string[]> {
  const rows = await allFolders();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const chain: string[] = [];
  for (let at: string | null = id; at; at = byId.get(at)?.parent_id ?? null) {
    if (chain.includes(at)) break;
    chain.push(at);
  }
  return chain;
}

async function parseParent(raw: unknown): Promise<string | null> {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string" || !(await getFolder(raw))) throw new ApiError("FOLDER_NOT_FOUND");
  return raw;
}

export async function createFolder(
  userId: string,
  input: { name?: unknown; parentId?: unknown },
): Promise<ProjectFolder> {
  const name = parseName(input.name);
  const parentId = await parseParent(input.parentId);
  if (parentId && (await ancestry(parentId)).length >= MAX_DEPTH) throw new ApiError("FOLDER_TOO_DEEP");
  const count = (await db.prepare("SELECT COUNT(*) AS n FROM project_folders").get()) as { n: number };
  if (Number(count.n) >= MAX_FOLDERS) throw new ApiError("FOLDER_LIMIT_REACHED");
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO project_folders (id, name, parent_id, created_by) VALUES (?, ?, ?, ?)")
    .run(id, name, parentId, userId);
  return (await getFolder(id))!;
}

/** Whoever made the folder, or an instance administrator, renames, moves and deletes it. */
export function mayManageFolder(user: { id: string; isAdmin: boolean }, folder: ProjectFolder): boolean {
  return user.isAdmin || folder.createdBy === user.id;
}

export async function updateFolder(id: string, input: { name?: unknown; parentId?: unknown }): Promise<ProjectFolder> {
  const folder = await getFolder(id);
  if (!folder) throw new ApiError("FOLDER_NOT_FOUND");
  const name = input.name === undefined ? folder.name : parseName(input.name);
  let parentId = folder.parentId;
  if (input.parentId !== undefined) {
    parentId = await parseParent(input.parentId);
    // Not into itself or one of its own subfolders.
    if (parentId && (await ancestry(parentId)).includes(id)) throw new ApiError("FOLDER_MOVE_INVALID");
    if (parentId && (await ancestry(parentId)).length + (await subtreeDepth(id)) > MAX_DEPTH)
      throw new ApiError("FOLDER_TOO_DEEP");
  }
  await db.prepare("UPDATE project_folders SET name = ?, parent_id = ? WHERE id = ?").run(name, parentId, id);
  return (await getFolder(id))!;
}

async function subtreeDepth(id: string): Promise<number> {
  const rows = await allFolders();
  const depth = (at: string, seen: Set<string>): number => {
    if (seen.has(at)) return 0;
    seen.add(at);
    const children = rows.filter((row) => row.parent_id === at);
    return 1 + Math.max(0, ...children.map((child) => depth(child.id, seen)));
  };
  return depth(id, new Set());
}

/** Deletes the folder; what it held — projects and subfolders — moves up to where it was. */
export async function deleteFolder(id: string): Promise<{ movedProjects: number; movedFolders: number }> {
  const folder = await getFolder(id);
  if (!folder) throw new ApiError("FOLDER_NOT_FOUND");
  return await db.transaction(async () => {
    const projects = await db.prepare("UPDATE projects SET folder_id = ? WHERE folder_id = ?").run(folder.parentId, id);
    const folders = await db
      .prepare("UPDATE project_folders SET parent_id = ? WHERE parent_id = ?")
      .run(folder.parentId, id);
    await db.prepare("DELETE FROM project_folders WHERE id = ?").run(id);
    return { movedProjects: projects.changes, movedFolders: folders.changes };
  });
}

export async function setProjectFolder(projectId: string, folderId: unknown): Promise<string | null> {
  const target = await parseParent(folderId);
  await db.prepare("UPDATE projects SET folder_id = ? WHERE id = ?").run(target, projectId);
  return target;
}
