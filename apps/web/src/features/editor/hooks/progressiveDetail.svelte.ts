import type { Table } from "@nebuladb/shared";

/**
 * Opening a big schema builds every table with all its columns before anything is drawn: about ninety
 * DOM elements per table, a quarter of a second of work for 130 tables on a fast machine and a second
 * or more on a slow one, with the canvas empty throughout. Tables are therefore mounted "lite" first (a
 * header, no columns), which is enough to place and fit the whole schema, and take their columns back
 * in a few batches afterwards, the ones nearest the middle of the view first.
 *
 * Few batches, not many: every batch makes the flow rebuild its lookups for all the nodes and relations,
 * so that cost is paid per batch, however few tables it holds. Measured on 132 tables, thirty small batches
 * cost four times what one large one did.
 *
 * A small schema does not need it and never goes lite. A table added later does not either: only the
 * tables present at the first load are ever in the set.
 */

/** Below this many tables, mounting everything at once is quick enough to be left alone. */
export const LITE_MIN_TABLES = 24;
/** How many batches the tables come back in. */
const BATCHES = 6;
/** Between two batches, so the browser draws and answers input in between. */
const GAP_MS = 120;
/** After the canvas is fitted, before the first batch. */
const FIRST_DELAY_MS = 100;

const EMPTY: ReadonlySet<string> = new Set();

export interface ProgressiveDetail {
  /** Ids of the tables still lite. Replaced (never mutated) as tables are upgraded. */
  readonly lite: ReadonlySet<string>;
  /** The schema was big enough to be mounted lite: otherwise there is nothing to wait for. */
  readonly active: boolean;
  /** True once every table has its columns: the canvas can be fitted a last time. */
  readonly settled: boolean;
  /** How much of the schema has its columns back, 0 to 1 (0 until the upgrade begins). */
  readonly progress: number;
  /** Brings one table's columns back now (the pointer is on it). */
  upgrade: (tableId: string) => void;
  /** Brings every table's columns back now (the view is zoomed in enough to read them). */
  upgradeAll: () => void;
  /** The canvas is on screen and fitted: the upgrade can start. */
  start: () => void;
}

export function useProgressiveDetail(tables: () => readonly Table[]): ProgressiveDetail {
  let lite = $state.raw<ReadonlySet<string>>(EMPTY);
  let settled = $state(false);
  let began = $state(false);
  let canvasShown = false;
  let total = $state(0);
  let queue: string[] = [];
  let batchSize = 1;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const remove = (ids: readonly string[]) => {
    if (ids.length === 0) return;
    const next = new Set(lite);
    for (const id of ids) next.delete(id);
    lite = next;
  };

  const finish = () => {
    clearTimeout(timer);
    timer = undefined;
    settled = true;
  };

  const tick = () => {
    timer = undefined;
    remove(queue.splice(0, batchSize));
    if (queue.length > 0) timer = setTimeout(tick, GAP_MS);
    else finish();
  };

  const begin = () => {
    if (timer === undefined && queue.length > 0) timer = setTimeout(tick, FIRST_DELAY_MS);
  };

  $effect(() => {
    if (began) return;
    const list = tables();
    if (list.length < LITE_MIN_TABLES) return;
    began = true;
    // Nearest the middle of the schema first: that is where the fitted view looks, and where the pointer lands.
    const cx = list.reduce((sum, t) => sum + t.position.x, 0) / list.length;
    const cy = list.reduce((sum, t) => sum + t.position.y, 0) / list.length;
    queue = list
      .filter((t) => t.detailLevel !== "compact")
      .map((t) => ({ id: t.id, d: (t.position.x - cx) ** 2 + (t.position.y - cy) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .map((entry) => entry.id);
    batchSize = Math.max(1, Math.ceil(queue.length / BATCHES));
    total = queue.length;
    lite = new Set(queue);
    if (canvasShown) begin();
    return () => clearTimeout(timer);
  });

  return {
    get lite() {
      return lite;
    },
    get active() {
      return began;
    },
    get settled() {
      return settled;
    },
    get progress() {
      return total === 0 ? 0 : 1 - lite.size / total;
    },
    upgrade(tableId) {
      if (!lite.has(tableId)) return;
      queue = queue.filter((id) => id !== tableId);
      remove([tableId]);
      if (queue.length === 0) finish();
    },
    upgradeAll() {
      if (!began || lite.size === 0) return;
      queue = [];
      remove([...lite]);
      finish();
    },
    start() {
      canvasShown = true;
      if (began) begin();
    },
  };
}
