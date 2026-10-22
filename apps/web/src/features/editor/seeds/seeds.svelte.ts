import type { TableSeedSummary } from "@nebuladb/shared";
import { fetchSeeds } from "@/services/seedsApi";

/** Quiet time after the last schema edit before the seeds are checked again. */
const SCHEMA_REFRESH_DELAY_MS = 1200;

const NO_SEEDS: ReadonlyMap<string, TableSeedSummary> = new Map();

/**
 * The project's seeds, by table id, as the server last listed them — what the
 * canvas needs to show a table has initial rows. Refetched when the project
 * changes and when the server announces `seeds-changed`.
 */
export class SeedsState {
  byTable = $state.raw<ReadonlyMap<string, TableSeedSummary>>(NO_SEEDS);
  private requested = 0;

  /**
   * `schemaKey` changes whenever something a seed is checked against does (a column's type or length):
   * the server's overflow check is then asked again, once the typing has paused.
   */
  constructor(
    private readonly projectId: () => string,
    private readonly schemaKey: () => string = () => "",
  ) {
    $effect(() => {
      this.projectId();
      this.byTable = NO_SEEDS;
      void this.refresh();
    });
    let lastKey: string | null = null;
    $effect(() => {
      const key = this.schemaKey();
      if (lastKey === null || key === lastKey) {
        lastKey = key;
        return;
      }
      lastKey = key;
      const timer = setTimeout(() => void this.refresh(), SCHEMA_REFRESH_DELAY_MS);
      return () => clearTimeout(timer);
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
