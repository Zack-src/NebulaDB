import type { EnvironmentStage, EnvironmentStageInput } from "@nebuladb/shared";
import { request } from "./httpClient";

/** The instance's deployment chain, in order — readable by anyone signed in. */
export async function fetchEnvironments(): Promise<EnvironmentStage[]> {
  return (await request<{ environments: EnvironmentStage[] }>("/api/environments")).environments;
}

export async function createEnvironment(input: EnvironmentStageInput): Promise<EnvironmentStage> {
  return (await request<{ environment: EnvironmentStage }>("/api/admin/environments", { method: "POST", body: input }))
    .environment;
}

export async function updateEnvironment(id: string, input: EnvironmentStageInput): Promise<EnvironmentStage> {
  return (
    await request<{ environment: EnvironmentStage }>(`/api/admin/environments/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: input,
    })
  ).environment;
}

export function deleteEnvironment(id: string): Promise<void> {
  return request<void>(`/api/admin/environments/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function reorderEnvironments(ids: string[]): Promise<EnvironmentStage[]> {
  return (
    await request<{ environments: EnvironmentStage[] }>("/api/admin/environments/order", {
      method: "PUT",
      body: { ids },
    })
  ).environments;
}
