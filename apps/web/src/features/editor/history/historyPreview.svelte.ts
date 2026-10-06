import { diffProjects } from "@nebuladb/dbml-engine";
import type { Project } from "@nebuladb/shared";
import type { HistoryDiffStatus } from "@/features/editor/hooks/useCanvasNodes/canvasNodes.svelte";
import type { RevisionSummary } from "@/services/projectsApi";

/**
 * "Aperçu sur le graphe" from the history tab: the schema tab with the tables added or changed
 * since a revision outlined. Recomputed against the live project, so the outline follows edits made
 * meanwhile. Leaving the project (or a revision from another one) ends the preview.
 */
export class HistoryPreviewState {
  preview = $state.raw<{ revision: RevisionSummary; project: Project } | null>(null);
  /** The revision the history tab shows when it is opened again: the one last previewed. */
  revisionId = $state<string | null>(null);

  constructor(
    private readonly projectId: () => string,
    private readonly liveProject: () => Project | null,
  ) {
    $effect(() => {
      this.projectId();
      this.preview = null;
      this.revisionId = null;
    });
  }

  readonly diff = $derived.by(() => {
    const live = this.liveProject();
    return this.preview && live ? diffProjects(this.preview.project, live) : null;
  });

  /** Outline status per table id, for the canvas. */
  readonly diffStatus = $derived.by((): ReadonlyMap<string, HistoryDiffStatus> | null => {
    if (!this.diff) return null;
    const marks = new Map<string, HistoryDiffStatus>();
    for (const table of this.diff.tables) {
      if (table.status !== "removed") marks.set(table.id, table.status);
    }
    return marks;
  });

  show(revision: RevisionSummary, project: Project): void {
    this.preview = { revision, project };
    this.revisionId = revision.id;
  }

  close = (): void => {
    this.preview = null;
  };
}
