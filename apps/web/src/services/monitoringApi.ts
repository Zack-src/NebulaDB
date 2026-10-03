import type { DriftEvent, MonitorSettings } from "@athanordb/shared";
import { request } from "./httpClient";

export interface MonitoringState {
  settings: MonitorSettings;
  events: DriftEvent[];
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
