import type { AccountWatchState, DriftEvent, MonitorSettings } from "@nebuladb/shared";
import { request } from "./httpClient";

export interface MonitoringState {
  settings: MonitorSettings;
  events: DriftEvent[];
  /** The accounts watch — `null` unless the caller is an instance administrator. */
  accounts: AccountWatchState | null;
}

const base = (projectId: string) => `/api/projects/${projectId}/monitoring`;

export function fetchMonitoring(projectId: string): Promise<MonitoringState> {
  return request<MonitoringState>(base(projectId));
}

export async function saveMonitoring(
  projectId: string,
  settings: Omit<MonitorSettings, "lastCheckedAt">,
): Promise<MonitorSettings> {
  return (await request<{ settings: MonitorSettings }>(base(projectId), { method: "PUT", body: settings })).settings;
}

/** Reads the watched databases now, instead of waiting for the next pass. */
export function runMonitoringCheck(projectId: string): Promise<MonitoringState> {
  return request<MonitoringState>(`${base(projectId)}/check`, { method: "POST" });
}

/** Instance administrators: watch the accounts and privileges of the project's databases too, or stop. */
export function setAccountWatch(projectId: string, enabled: boolean): Promise<MonitoringState> {
  return request<MonitoringState>(`${base(projectId)}/accounts`, { method: "PUT", body: { enabled } });
}

/** Instance administrators: the accounts as last read become the reference; open findings close. */
export function acceptAccountState(projectId: string, connectionId: string): Promise<MonitoringState> {
  return request<MonitoringState>(`${base(projectId)}/accounts/accept`, { method: "POST", body: { connectionId } });
}
