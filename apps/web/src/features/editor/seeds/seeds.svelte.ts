import type { TableSeedSummary } from "@athanordb/shared";
import { fetchSeeds } from "@/services/seedsApi";

const NO_SEEDS: ReadonlyMap<string, TableSeedSummary> = new Map();

/**
 * The project's seeds, by table id, as the server last listed them — what the
 * canvas needs to show a table has initial rows. Refetched when the project
 * changes and when the server announces `seeds-changed`.
 */
export class SeedsState {
  byTable = $state.raw<ReadonlyMap<string, TableSeedSummary>>(NO_SEEDS);
  private requested = 0;

  constructor(private readonly projectId: () => string) {
    $effect(() => {
      this.projectId();
      this.byTable = NO_SEEDS;
      void this.refresh();
    });
  }

  refresh = async (): Promise<void> => {
    const ticket = ++this.requested;
    try {
      const seeds = await fetchSeeds(this.projectId());
      if (ticket !== this.requested) return;
      this.byTable = new Map(seeds.map((seed) => [seed.tableId, seed]));
    } catch {
      // Offline, or the perf harness: no seeds shown is better than a broken canvas.
    }
  };
}
