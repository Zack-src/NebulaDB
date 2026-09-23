import { request } from "./httpClient";

export interface SearchHit {
  projectId: string;
  projectName: string;
  kind: "table" | "field" | "enum";
  tableId?: string;
  tableName?: string;
  fieldName?: string;
  fieldType?: string;
  enumName?: string;
  rank: number;
}

export interface SearchResult {
  hits: SearchHit[];
  /** More matches exist than the server returns — the query is worth narrowing. */
  truncated: boolean;
}

/** Tables, columns and enums matching `query` across every project the caller can see. */
export function searchSchemas(query: string, signal?: AbortSignal): Promise<SearchResult> {
  return request<SearchResult>("/api/search", { query: { q: query }, signal });
}
