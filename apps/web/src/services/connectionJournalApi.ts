import type {
  DbActivityEntry,
  DbActivityWatch,
  DbHealthBoard,
  DbQueryStat,
  DbQueryStatSort,
  DbServerCounters,
  DbTrafficBucket,
} from "@athanordb/shared";
import { request } from "./httpClient";

/**
 * A database's journal (Admin → Connexions → Ouvrir → Journal). The entries
 * themselves come from the activity routes (`activityApi.ts`) filtered on the
 * connection; these are the two things only the journal needs.
 */
const base = (connectionId: string) => `/api/admin/connections/${connectionId}`;

export interface JournalActor {
  id: string;
  name: string | null;
  email: string | null;
}

/** The people who appear in the database's journal, for the author filter. */
export async function fetchJournalActors(connectionId: string): Promise<JournalActor[]> {
  return (await request<{ actors: JournalActor[] }>(`${base(connectionId)}/journal/actors`)).actors;
}

/** Statement shapes run through Athanor's SQL console, aggregated; `days` 0 for every day kept. */
export async function fetchQueryStats(
  connectionId: string,
  options: { days: number; sort: DbQueryStatSort },
): Promise<DbQueryStat[]> {
  return (
    await request<{ stats: DbQueryStat[] }>(`${base(connectionId)}/query-stats`, {
      query: { sort: options.sort, ...(options.days ? { days: String(options.days) } : {}) },
    })
  ).stats;
}

/** What the database server itself shows (sessions, statements), sampled; `outside` leaves out the accounts Athanor uses. */
export function fetchDbActivity(
  connectionId: string,
  options: { days: number; outside: boolean },
): Promise<{ watch: DbActivityWatch; entries: DbActivityEntry[] }> {
  return request(`${base(connectionId)}/activity`, {
    query: { days: String(options.days), ...(options.outside ? { outside: "1" } : {}) },
  });
}

/** Reads the server's sessions now. */
export function sampleDbActivity(connectionId: string): Promise<{ sessions: number }> {
  return request(`${base(connectionId)}/activity/sample`, { method: "POST" });
}

export function setDbActivityWatch(connectionId: string, enabled: boolean): Promise<DbActivityWatch> {
  return request(`${base(connectionId)}/activity/watch`, { method: "PUT", body: { enabled } });
}

/** The server's own counters as differences between reads; `kind` says what "queries" counts. */
export function fetchDbTraffic(
  connectionId: string,
  days: number,
): Promise<{ kind: DbServerCounters["queriesKind"] | null; buckets: DbTrafficBucket[] }> {
  return request(`${base(connectionId)}/activity/traffic`, { query: { days: String(days) } });
}

/** A fresh probe plus sizes, sessions and locks; a part the server cannot give is `null`. */
export function fetchHealthBoard(connectionId: string): Promise<DbHealthBoard> {
  return request(`${base(connectionId)}/health-board`);
}
