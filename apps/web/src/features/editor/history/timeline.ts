import type { HistoryMarker, RevisionChanges } from "@nebuladb/shared";
import { parseServerTime } from "@/features/sql/format";
import type { RevisionSummary } from "@/services/projectsApi";

type TableStatus = RevisionChanges["tables"][number]["status"];

/**
 * One line of the history: a run of revisions by one person, close together
 * in time, read as a single edit. Restoring it means restoring its **last**
 * revision; the ones before stay reachable by expanding the line.
 */
export interface RevisionEntry {
  kind: "revisions";
  /** The last revision's id — the one the line stands for. */
  id: string;
  /** Oldest first. */
  revisions: RevisionSummary[];
  author: string | null;
  label: string | null;
  /** The first revision's time; `createdAt` of the last one is the line's own. */
  startedAt: string;
  createdAt: string;
  /** Tables the run touched, with their net status over the run. */
  tables: { name: string; status: TableStatus }[];
  moreTables: number;
  refs: number;
}

interface MarkerEntry {
  kind: "marker";
  id: string;
  marker: HistoryMarker;
}

export type TimelineEntry = RevisionEntry | MarkerEntry;

export interface TimelineOptions {
  /** Two revisions further apart than this never share a line. */
  maxGapMs?: number;
  /** Nor does a run longer than this, so an afternoon of edits is not one line. */
  maxSpanMs?: number;
}

const DEFAULT_GAP_MS = 2 * 60_000;
const DEFAULT_SPAN_MS = 15 * 60_000;

/**
 * The history as it is shown: revisions grouped into runs, markers placed
 * among them by time, **newest first**.
 *
 * A run is consecutive revisions by the same author, each at most `maxGapMs`
 * after the previous one and the whole within `maxSpanMs`. A labelled
 * revision (a checkpoint someone named) always stands alone, and a marker
 * (a lock, a deployment…) ends the run it falls into — "before" and "after"
 * that event must stay distinct points to restore to.
 */
export function buildTimeline(
  revisions: readonly RevisionSummary[],
  markers: readonly HistoryMarker[],
  options: TimelineOptions = {},
): TimelineEntry[] {
  const maxGap = options.maxGapMs ?? DEFAULT_GAP_MS;
  const maxSpan = options.maxSpanMs ?? DEFAULT_SPAN_MS;

  // Times are only to the second, so within one second the order comes from
  // `rank`: revisions keep their list order, a restore marker sits right
  // before the revision it wrote (`producedRevisionId`) — it reads as the
  // cause of that state, not as one more step of the edits before it — and
  // any other marker comes after that second's revisions.
  type Item = { at: number; rank: number } & ({ revision: RevisionSummary } | { marker: HistoryMarker; index: number });
  const position = new Map(revisions.map((revision, index) => [revision.id, index]));
  const items: Item[] = [
    ...revisions.map((revision, index) => ({
      at: parseServerTime(revision.createdAt).getTime(),
      rank: 2 * index + 1,
      revision,
    })),
    ...markers.map((marker, index) => {
      const produced = marker.producedRevisionId ? position.get(marker.producedRevisionId) : undefined;
      return produced === undefined
        ? { at: parseServerTime(marker.at).getTime(), rank: Number.MAX_SAFE_INTEGER, marker, index }
        : { at: parseServerTime(revisions[produced].createdAt).getTime(), rank: 2 * produced, marker, index };
    }),
  ];
  items.sort((a, b) => a.at - b.at || a.rank - b.rank);

  const entries: TimelineEntry[] = [];
  let run: RevisionSummary[] = [];
  let runStart = 0;
  let runLast = 0;
  const flush = () => {
    if (run.length > 0) entries.push(toEntry(run));
    run = [];
  };

  for (const item of items) {
    if ("marker" in item) {
      flush();
      entries.push({ kind: "marker", id: `marker-${item.index}`, marker: item.marker });
      continue;
    }
    const revision = item.revision;
    const joins =
      run.length > 0 &&
      !revision.label &&
      !run[run.length - 1].label &&
      run[0].author === revision.author &&
      item.at - runLast <= maxGap &&
      item.at - runStart <= maxSpan;
    if (!joins) {
      flush();
      runStart = item.at;
    }
    run.push(revision);
    runLast = item.at;
  }
  flush();
  return entries.reverse();
}

function toEntry(run: RevisionSummary[]): RevisionEntry {
  const last = run[run.length - 1];
  // Net status of each table over the run: created then edited is "added",
  // created then dropped never happened, anything ending in a drop is "removed".
  const first = new Map<string, TableStatus>();
  const latest = new Map<string, TableStatus>();
  let moreTables = 0;
  let refs = 0;
  for (const revision of run) {
    for (const table of revision.changes?.tables ?? []) {
      if (!first.has(table.name)) first.set(table.name, table.status);
      latest.set(table.name, table.status);
    }
    moreTables = Math.max(moreTables, revision.changes?.moreTables ?? 0);
    refs += revision.changes?.refs ?? 0;
  }
  const tables: RevisionEntry["tables"] = [];
  for (const [name, initial] of first) {
    const final = latest.get(name)!;
    if (initial === "added" && final === "removed") continue;
    tables.push({ name, status: initial === "added" ? "added" : final === "removed" ? "removed" : "changed" });
  }
  return {
    kind: "revisions",
    id: last.id,
    revisions: run,
    author: last.author,
    label: last.label,
    startedAt: run[0].createdAt,
    createdAt: last.createdAt,
    tables,
    moreTables,
    refs,
  };
}
