import type { LintSettings } from "@athanordb/dbml-engine";
import { request } from "./httpClient";

/** Where a project's rules come from: its own version, a preset chosen for it, the instance default, or the built-in ones. */
export interface LintSource {
  kind: "own" | "preset" | "default" | "builtin";
  presetId?: string;
  presetName?: string;
}

/** A preset as offered to a project's administrators. */
export interface LintPresetChoice {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
}

/** A preset in the instance's library (Admin → Lint). */
export interface LintPreset extends LintPresetChoice {
  settings: LintSettings;
  /** Projects that follow this preset explicitly. */
  projectCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface LintState {
  settings: LintSettings;
  source: LintSource;
  /** Empty unless the reader administers the project. */
  presets: LintPresetChoice[];
}

const base = (projectId: string) => `/api/projects/${projectId}/lint`;

export function fetchLintState(projectId: string): Promise<LintState> {
  return request<LintState>(base(projectId));
}

/** The project's own version of the rules. Project administrators only. */
export function saveLintSettings(projectId: string, settings: LintSettings): Promise<LintState> {
  return request<LintState>(base(projectId), { method: "PUT", body: { settings } });
}

/** Follows a preset, or with `null` the instance default; the project's own version is dropped. */
export function chooseLintPreset(projectId: string, presetId: string | null): Promise<LintState> {
  return request<LintState>(base(projectId), { method: "PUT", body: { presetId } });
}

const presets = "/api/admin/lint-presets";

/** Instance administrators only: the library. */
export function fetchLintPresets(): Promise<{ presets: LintPreset[]; defaultId: string | null }> {
  return request(presets);
}

export async function createLintPreset(input: {
  name: string;
  description?: string;
  settings: LintSettings;
}): Promise<LintPreset> {
  return (await request<{ preset: LintPreset }>(presets, { method: "POST", body: input })).preset;
}

export async function updateLintPreset(
  id: string,
  input: { name?: string; description?: string; settings?: LintSettings },
): Promise<LintPreset> {
  return (await request<{ preset: LintPreset }>(`${presets}/${encodeURIComponent(id)}`, { method: "PUT", body: input }))
    .preset;
}

export function deleteLintPreset(id: string): Promise<{ ok: true; detached: number }> {
  return request(`${presets}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** `null` removes the default: projects that chose nothing get the built-in rules. */
export function setDefaultLintPreset(id: string | null): Promise<{ defaultId: string | null }> {
  return request(`${presets}/default`, { method: "PUT", body: { id } });
}

export function applyLintPreset(id: string, projectIds: string[]): Promise<{ applied: number; skipped: string[] }> {
  return request(`${presets}/${encodeURIComponent(id)}/apply`, { method: "POST", body: { projectIds } });
}
