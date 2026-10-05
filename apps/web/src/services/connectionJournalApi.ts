import type { DbQueryStat, DbQueryStatSort } from "@athanordb/shared";
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
