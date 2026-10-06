import type { TableGeneratorConfig } from "@nebuladb/shared";
import { request } from "./httpClient";

const base = (projectId: string, tableId: string) =>
  `/api/projects/${projectId}/generators/${encodeURIComponent(tableId)}`;

export interface GeneratorRun {
  provider: string;
  /** The columns of `csv`, in order, with the field each one fills. */
  columns: { fieldId: string; name: string }[];
  csv: string;
  rowCount: number;
  problems: { column: string; reason: "no-parent-values" | "unique-exhausted" }[];
}

/** The settings last saved for this table, or `null`. */
export async function fetchGeneratorConfig(projectId: string, tableId: string): Promise<TableGeneratorConfig | null> {
  return (await request<{ config: TableGeneratorConfig | null }>(base(projectId, tableId))).config;
}

export async function saveGeneratorConfig(
  projectId: string,
  tableId: string,
  config: TableGeneratorConfig,
): Promise<void> {
  await request<{ config: TableGeneratorConfig }>(base(projectId, tableId), { method: "PUT", body: config });
}

export function runGenerator(projectId: string, tableId: string, config: TableGeneratorConfig): Promise<GeneratorRun> {
  return request<GeneratorRun>(`${base(projectId, tableId)}/run`, { method: "POST", body: { config } });
}
