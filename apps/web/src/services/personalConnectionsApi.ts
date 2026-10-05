import type { DatabaseConnectionConfig, DatabaseConnectionSummary } from "@athanordb/shared";
import { request } from "./httpClient";
export interface MyConnections {
  shared: DatabaseConnectionSummary[];
  personal: DatabaseConnectionSummary[];
}
export function fetchMyConnections(): Promise<MyConnections> {
  return request("/api/me/connections");
}
export function savePersonalConnection(
  config: Omit<DatabaseConnectionConfig, "id" | "projectId">,
  id?: string,
): Promise<{ connection: DatabaseConnectionSummary }> {
  return request(`/api/me/connections${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", body: config });
}
export function deletePersonalConnection(id: string): Promise<{ deleted: boolean }> {
  return request(`/api/me/connections/${id}`, { method: "DELETE" });
}
