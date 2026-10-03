import type { SeedOptions, TableSeed, TableSeedSummary } from "@athanordb/shared";
import { request } from "./httpClient";

const base = (projectId: string) => `/api/projects/${projectId}/seeds`;

/** Every seed of the project, without the files. */
export async function fetchSeeds(projectId: string): Promise<TableSeedSummary[]> {
  return (await request<{ seeds: TableSeedSummary[] }>(base(projectId))).seeds;
}

export async function fetchSeed(projectId: string, tableId: string): Promise<TableSeed> {
  return (await request<{ seed: TableSeed }>(`${base(projectId)}/${encodeURIComponent(tableId)}`)).seed;
}

export async function saveSeed(
  projectId: string,
  tableId: string,
  input: { content: string; options: SeedOptions },
): Promise<TableSeed> {
  return (
    await request<{ seed: TableSeed }>(`${base(projectId)}/${encodeURIComponent(tableId)}`, {
      method: "PUT",
      body: input,
    })
  ).seed;
}

export function deleteSeed(projectId: string, tableId: string): Promise<void> {
  return request<void>(`${base(projectId)}/${encodeURIComponent(tableId)}`, { method: "DELETE" });
}
