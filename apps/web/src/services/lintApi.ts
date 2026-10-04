import type { LintSettings } from "@athanordb/dbml-engine";
import { request } from "./httpClient";

const base = (projectId: string) => `/api/projects/${projectId}/lint`;

export async function fetchLintSettings(projectId: string): Promise<LintSettings> {
  return (await request<{ settings: LintSettings }>(base(projectId))).settings;
}

/** Project administrators only. */
export async function saveLintSettings(projectId: string, settings: LintSettings): Promise<LintSettings> {
  return (await request<{ settings: LintSettings }>(base(projectId), { method: "PUT", body: settings })).settings;
}
