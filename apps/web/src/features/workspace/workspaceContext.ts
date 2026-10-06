import { getContext, setContext } from "svelte";

/**
 * What a component rendered somewhere inside a project's workspace can ask of
 * it, without knowing where it sits.
 *
 * A database result can navigate to the corresponding schema table.
 * Outside the project workspace, navigation falls back to a plain link.
 */
export interface WorkspaceContext {
  /**
   * Shows the schema tab with this table (and column) in view. Returns `false`
   * when `projectId` is not the project this workspace has open — the caller
   * then navigates there instead.
   */
  openInSchema: (projectId: string, tableName?: string, fieldName?: string) => boolean;
  /**
   * Opens the schema table's "initial data" dialog on the rows the current
   * database holds for it. Returns `false` when the schema has no table of
   * that name, or this user may not change its seed.
   */
  seedFromDatabase: (tableName: string) => boolean;
}

const KEY = Symbol("workspace");

export function provideWorkspace(context: WorkspaceContext): void {
  setContext(KEY, context);
}

/** `undefined` outside a workspace. */
export function useWorkspace(): WorkspaceContext | undefined {
  return getContext<WorkspaceContext | undefined>(KEY);
}
