import type { WorkspaceTab } from "@/features/projects/projectRouting.svelte";
import type { PermissionLevel } from "@/types";

/**
 * The workspace tabs one user sees on a project, in bar order. Only
 * deployments is restricted (the project's administrators); the rest follow
 * from being able to open the project at all. Shared by the tab bar and the
 * global palette so the two can never disagree.
 */
export function visibleWorkspaceTabs(permission: PermissionLevel): WorkspaceTab[] {
  const tabs: WorkspaceTab[] = ["schema"];
  if (permission === "administrator") tabs.push("deployments");
  tabs.push("history", "problems", "dictionary");
  return tabs;
}
