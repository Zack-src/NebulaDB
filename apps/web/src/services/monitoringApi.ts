import type { MonitorSettings } from "@nebuladb/shared";
import { request } from "./httpClient";

const base = (projectId: string) => `/api/projects/${projectId}/monitoring`;

/** The project's watch settings. Readable by anyone who sees the project. */
export async function fetchMonitoringSettings(projectId: string): Promise<MonitorSettings> {
  return (await request<{ settings: MonitorSettings }>(base(projectId))).settings;
}

/** Project administrators only. A watch imposed from a connection keeps its on/off and pace whatever is sent. */
export async function saveMonitoring(
  projectId: string,
  settings: Omit<MonitorSettings, "lastCheckedAt">,
): Promise<MonitorSettings> {
  return (await request<{ settings: MonitorSettings }>(base(projectId), { method: "PUT", body: settings })).settings;
}

/** Reads the watched databases now, instead of waiting for the next pass (those who may deploy). */
export async function runMonitoringCheck(projectId: string): Promise<MonitorSettings> {
  return (await request<{ settings: MonitorSettings }>(`${base(projectId)}/check`, { method: "POST" })).settings;
}
