import type { SeedFromDatabase, SeedIssue, SeedOptions, TableSeed, TableSeedSummary } from "@nebuladb/shared";
import { ApiError, NetworkError } from "./ApiError";
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

/** The table's rows as they are in one of the project's databases, as a seed to review — nothing is saved. Instance administrators only. */
export async function readSeedFromDatabase(
  projectId: string,
  tableId: string,
  connectionId: string,
): Promise<SeedFromDatabase> {
  return (
    await request<{ seed: SeedFromDatabase }>(`${base(projectId)}/${encodeURIComponent(tableId)}/from-database`, {
      method: "POST",
      body: { connectionId },
    })
  ).seed;
}

/** What a big seed's own check found, once the whole file has been read on the server. */
export interface SeedFileResult {
  seed: TableSeedSummary;
  /** The first issues found (at most 200) and how many there are in all. */
  issues: SeedIssue[];
  total: number;
}

/** The first rows of a seed (header included), parsed — the only look at a file kept on the server. */
export async function fetchSeedPreview(projectId: string, tableId: string, rows = 50): Promise<(string | null)[][]> {
  return (
    await request<{ rows: (string | null)[][] }>(`${base(projectId)}/${encodeURIComponent(tableId)}/preview`, {
      query: { rows },
    })
  ).rows;
}

/**
 * Sends a CSV as the raw bytes of the file, to be kept on the server and checked as it arrives. `options`
 * `null` lets the server read them from the file. XMLHttpRequest rather than `fetch`: it reports how much has
 * gone up, which is what a gigabyte needs.
 */
export function uploadSeedFile(
  projectId: string,
  tableId: string,
  file: File,
  options: SeedOptions | null,
  onProgress: (sent: number, total: number) => void,
): Promise<SeedFileResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `${base(projectId)}/${encodeURIComponent(tableId)}/file`);
    xhr.setRequestHeader("Content-Type", "text/csv");
    if (options) xhr.setRequestHeader("x-seed-options", encodeURIComponent(JSON.stringify(options)));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    xhr.onerror = () => reject(new NetworkError("the server could not be reached"));
    xhr.onload = () => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(xhr.responseText || "{}") as Record<string, unknown>;
      } catch {
        // Not JSON: reported below with the status alone.
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as unknown as SeedFileResult);
        return;
      }
      const { error, code, ...details } = payload;
      reject(
        new ApiError(
          xhr.status,
          typeof code === "string" ? code : null,
          typeof error === "string" ? error : `request failed (${xhr.status})`,
          details,
        ),
      );
    };
    xhr.send(file);
  });
}

/** How a file kept on the server is read: the file stays, it is checked again under these options. */
export function saveSeedOptions(projectId: string, tableId: string, options: SeedOptions): Promise<SeedFileResult> {
  return request<SeedFileResult>(`${base(projectId)}/${encodeURIComponent(tableId)}/options`, {
    method: "PUT",
    body: options,
  });
}

/** A file of the server's import folder as the table's seed — instance administrators only. */
export function importSeedFromPath(projectId: string, tableId: string, path: string): Promise<SeedFileResult> {
  return request<SeedFileResult>(`${base(projectId)}/${encodeURIComponent(tableId)}/from-path`, {
    method: "POST",
    body: { path },
  });
}

export interface SeedFolderEntry {
  file: string;
  table: string | null;
  status: "imported" | "no-table" | "failed";
  rows?: number;
  errors?: number;
  warnings?: number;
  message?: string;
}

/** Every `<table>.csv` of a folder of the server's import folder as that table's seed — instance administrators only. */
export async function importSeedFolder(projectId: string, path: string): Promise<SeedFolderEntry[]> {
  return (
    await request<{ results: SeedFolderEntry[] }>(`${base(projectId)}/import-folder`, {
      method: "POST",
      body: { path },
    })
  ).results;
}
