import { getContext, setContext } from "svelte";

/**
 * What a component rendered somewhere inside a project's workspace can ask of
 * it, without knowing where it sits.
 *
 * First use: the database console, when it is the workspace's "Données & SQL"
 * tab, sends a structural change to the schema. Inside the workspace that is a
 * tab change with the table selected; from the admin console, where there is
 * no workspace, the same dialog falls back to a plain link.
 */
export interface WorkspaceContext {
  /**
   * Shows the schema tab with this table (and column) in view. Returns `false`
   * when `projectId` is not the project this workspace has open — the caller
   * then navigates there instead.
   */
  openInSchema: (projectId: string, tableName?: string, fieldName?: string) => boolean;
}

const KEY = Symbol("workspace");

export function provideWorkspace(context: WorkspaceContext): void {
  setContext(KEY, context);
}

/** `undefined` outside a workspace. */
export function useWorkspace(): WorkspaceContext | undefined {
  return getContext<WorkspaceContext | undefined>(KEY);
}
