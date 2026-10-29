import type { ProjectFolder } from "@nebuladb/shared";

/** From the top down to `folderId` itself; empty for the top. A folder hidden from the reader ends the path there. */
export function folderPath(folders: readonly ProjectFolder[], folderId: string | null): ProjectFolder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: ProjectFolder[] = [];
  for (
    let at = folderId ? byId.get(folderId) : undefined;
    at && !path.includes(at);
    at = at.parentId ? byId.get(at.parentId) : undefined
  ) {
    path.unshift(at);
  }
  return path;
}

/**
 * Where a project shows in the list: its folder when the reader sees that
 * folder, the top otherwise — a project is never lost behind a folder one
 * cannot see.
 */
export function shownFolderOf(folders: readonly ProjectFolder[], folderId: string | null | undefined): string | null {
  return folderId && folders.some((folder) => folder.id === folderId) ? folderId : null;
}

/** How many projects a folder holds, its subfolders included. */
export function countInFolder(
  folders: readonly ProjectFolder[],
  projects: readonly { folderId?: string | null }[],
  folderId: string,
): number {
  const inside = new Set([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId && inside.has(folder.parentId) && !inside.has(folder.id)) {
        inside.add(folder.id);
        grew = true;
      }
    }
  }
  return projects.filter((project) => project.folderId && inside.has(project.folderId)).length;
}
