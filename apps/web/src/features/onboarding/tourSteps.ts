import type { WorkspaceTab } from "@/features/projects/projectRouting.svelte";

export type TourStepId = "schema" | "deployments" | "history" | "dictionary" | "problems" | "sql" | "palette";

export interface TourStep {
  id: TourStepId;
  /** What the step points at; when it is not on screen the card stands alone. */
  selector: string;
}

const STEPS: readonly TourStep[] = [
  { id: "schema", selector: '[role="tab"][data-tab-id="schema"]' },
  { id: "deployments", selector: '[data-tour="deployments"]' },
  { id: "history", selector: '[role="tab"][data-tab-id="history"]' },
  { id: "dictionary", selector: '[role="tab"][data-tab-id="dictionary"]' },
  { id: "problems", selector: '[role="tab"][data-tab-id="problems"]' },
  { id: "sql", selector: '[data-tour="sql"]' },
  { id: "palette", selector: '[aria-keyshortcuts="Control+K Meta+K"]' },
];

/**
 * The steps of the workspace tour for what this user can see: a step about a
 * tab or a drawer they do not have would point at nothing. The palette is
 * always there.
 */
export function tourStepsFor(options: {
  tabs: readonly WorkspaceTab[];
  /** The deployments drawer is offered (the user may deploy). */
  deployments: boolean;
  /** The SQL drawer is offered (the user may query a linked database). */
  sql: boolean;
}): TourStep[] {
  return STEPS.filter((step) => {
    if (step.id === "deployments") return options.deployments;
    if (step.id === "sql") return options.sql;
    if (step.id === "palette") return true;
    return options.tabs.includes(step.id);
  });
}

/** Key names, not prose, so never translated; `Ctrl` reads `⌘` on a Mac keyboard. */
export function shortcutLabel(keys: string, mac: boolean): string {
  return mac ? keys.replace("Ctrl", "⌘") : keys;
}
