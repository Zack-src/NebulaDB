import { randomUUID } from "node:crypto";
import { DEFAULT_LINT_SETTINGS, parseLintSettings, type LintSettings } from "@athanordb/dbml-engine";
import { db } from "../../infrastructure/db.js";
import { ApiError } from "../../shared/errors.js";

/** At most this many presets in the library: a guard against abuse, not a product limit. */
export const MAX_LINT_PRESETS = 100;
const MAX_NAME = 100;
const MAX_DESCRIPTION = 300;

/** Where a project's effective settings come from. */
export interface LintSource {
  /** `own`: the project's own version · `preset`: a preset chosen for it · `default`: the instance's default preset · `builtin`: none of them. */
  kind: "own" | "preset" | "default" | "builtin";
  presetId?: string;
  presetName?: string;
}

export interface LintPreset {
  id: string;
  name: string;
  description: string;
  settings: LintSettings;
  isDefault: boolean;
  /** Projects that follow this preset explicitly (not through the default, not with their own version). */
  projectCount: number;
  createdAt: string;
  updatedAt: string;
}

interface PresetRow {
  id: string;
  name: string;
  description: string;
  settings_json: string;
  is_default: number;
  created_at: string;
  updated_at: string;
}

interface ProjectRow {
  settings_json: string;
  preset_id: string | null;
  use_own: number;
}

// A stored document written by a version whose rules have since changed is not
// trusted blindly: it goes through the same check as a request body.
const readSettings = (json: string): LintSettings | null => {
  try {
    return parseLintSettings(JSON.parse(json));
  } catch {
    return null;
  }
};

function toPreset(row: PresetRow, projectCount: number): LintPreset {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    settings: readSettings(row.settings_json) ?? { ...DEFAULT_LINT_SETTINGS },
    isDefault: row.is_default === 1,
    projectCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const presetRow = (id: string) =>
  db.prepare("SELECT * FROM lint_presets WHERE id = ?").get(id) as PresetRow | undefined;

function followerCount(presetId: string): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM lint_settings WHERE preset_id = ? AND use_own = 0").get(presetId) as {
      n: number;
    }
  ).n;
}

export function listLintPresets(): { presets: LintPreset[]; defaultId: string | null } {
  const rows = db.prepare("SELECT * FROM lint_presets ORDER BY name COLLATE NOCASE").all() as PresetRow[];
  const presets = rows.map((row) => toPreset(row, followerCount(row.id)));
  return { presets, defaultId: presets.find((preset) => preset.isDefault)?.id ?? null };
}

export function getLintPreset(id: string): LintPreset {
  const row = presetRow(id);
  if (!row) throw new ApiError("LINT_PRESET_NOT_FOUND");
  return toPreset(row, followerCount(id));
}

/** The name and description of a preset, as the project administrators who may pick one see them. */
export function listLintPresetChoices(): { id: string; name: string; description: string; isDefault: boolean }[] {
  return listLintPresets().presets.map(({ id, name, description, isDefault }) => ({
    id,
    name,
    description,
    isDefault,
  }));
}

function cleanName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > MAX_NAME) throw new ApiError("LINT_INVALID");
  return value.trim();
}

function cleanDescription(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > MAX_DESCRIPTION) throw new ApiError("LINT_INVALID");
  return value.trim();
}

const nameTaken = (name: string, exceptId?: string) =>
  Boolean(db.prepare("SELECT 1 FROM lint_presets WHERE name = ? COLLATE NOCASE AND id != ?").get(name, exceptId ?? ""));

export function createLintPreset(body: unknown, by: string): LintPreset {
  const input = (body ?? {}) as Record<string, unknown>;
  const name = cleanName(input.name);
  const description = cleanDescription(input.description);
  const settings = parseLintSettingsInput(input.settings);
  const count = (db.prepare("SELECT COUNT(*) AS n FROM lint_presets").get() as { n: number }).n;
  if (count >= MAX_LINT_PRESETS) throw new ApiError("LINT_PRESET_LIMIT");
  if (nameTaken(name)) throw new ApiError("LINT_PRESET_NAME_TAKEN");
  const id = randomUUID();
  db.prepare("INSERT INTO lint_presets (id, name, description, settings_json, created_by) VALUES (?, ?, ?, ?, ?)").run(
    id,
    name,
    description,
    JSON.stringify(settings),
    by,
  );
  return getLintPreset(id);
}

/** Changes a preset; `affected` are the projects whose effective settings just changed. */
export function updateLintPreset(id: string, body: unknown): { preset: LintPreset; affected: string[] } {
  const row = presetRow(id);
  if (!row) throw new ApiError("LINT_PRESET_NOT_FOUND");
  const input = (body ?? {}) as Record<string, unknown>;
  const name = input.name === undefined ? row.name : cleanName(input.name);
  const description = input.description === undefined ? row.description : cleanDescription(input.description);
  const settings =
    input.settings === undefined ? row.settings_json : JSON.stringify(parseLintSettingsInput(input.settings));
  if (name !== row.name && nameTaken(name, id)) throw new ApiError("LINT_PRESET_NAME_TAKEN");
  db.prepare(
    "UPDATE lint_presets SET name = ?, description = ?, settings_json = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(name, description, settings, id);
  return { preset: getLintPreset(id), affected: input.settings === undefined ? [] : projectsFollowing(id) };
}

/** Deletes a preset; the projects that followed it fall back to the default. */
export function deleteLintPreset(id: string): { detached: string[] } {
  const row = presetRow(id);
  if (!row) throw new ApiError("LINT_PRESET_NOT_FOUND");
  const detached = projectsFollowing(id);
  db.transaction(() => {
    db.prepare("UPDATE lint_settings SET preset_id = NULL WHERE preset_id = ?").run(id);
    db.prepare("DELETE FROM lint_presets WHERE id = ?").run(id);
  })();
  return { detached };
}

/** Makes a preset the instance default, or with `null` removes the default. */
export function setDefaultLintPreset(id: string | null): { defaultId: string | null; affected: string[] } {
  if (id !== null && !presetRow(id)) throw new ApiError("LINT_PRESET_NOT_FOUND");
  db.transaction(() => {
    db.prepare("UPDATE lint_presets SET is_default = 0 WHERE is_default = 1").run();
    if (id !== null) db.prepare("UPDATE lint_presets SET is_default = 1 WHERE id = ?").run(id);
  })();
  // Who follows "the default" does not depend on which preset it is: all of them see their rules change.
  return { defaultId: id, affected: defaultFollowers() };
}

/**
 * Points projects at a preset. The settings a project had of its own are
 * dropped: it follows the preset from now on. Unknown project ids are skipped.
 */
export function applyLintPreset(
  presetId: string,
  projectIds: unknown,
  by: string,
): { applied: string[]; skipped: string[] } {
  if (!presetRow(presetId)) throw new ApiError("LINT_PRESET_NOT_FOUND");
  if (!Array.isArray(projectIds) || projectIds.length > 200 || projectIds.some((id) => typeof id !== "string")) {
    throw new ApiError("LINT_INVALID");
  }
  const applied: string[] = [];
  const skipped: string[] = [];
  db.transaction(() => {
    for (const id of new Set(projectIds as string[])) {
      if (!db.prepare("SELECT 1 FROM projects WHERE id = ?").get(id)) {
        skipped.push(id);
        continue;
      }
      setProjectPreset(id, presetId, by);
      applied.push(id);
    }
  })();
  return { applied, skipped };
}

/** The projects that follow `presetId` explicitly. */
function projectsFollowing(presetId: string): string[] {
  const explicit = db
    .prepare("SELECT project_id AS id FROM lint_settings WHERE preset_id = ? AND use_own = 0")
    .all(presetId) as { id: string }[];
  const ids = new Set(explicit.map((row) => row.id));
  const row = presetRow(presetId);
  if (row?.is_default === 1) for (const id of defaultFollowers()) ids.add(id);
  return [...ids];
}

/** Projects that fall back to the instance default: no version of their own and no (existing) preset chosen. */
function defaultFollowers(): string[] {
  return (
    db
      .prepare(
        `SELECT p.id AS id FROM projects p LEFT JOIN lint_settings l ON l.project_id = p.id
         WHERE COALESCE(l.use_own, 0) = 0
           AND (l.preset_id IS NULL OR l.preset_id NOT IN (SELECT id FROM lint_presets))`,
      )
      .all() as { id: string }[]
  ).map((row) => row.id);
}

/**
 * A project's settings as they apply: its own version when it has one, else the
 * preset chosen for it, else the instance default preset, else the built-in
 * defaults. The one place this is decided — the editor, the API and the
 * deployment check all read it.
 */
export function resolveProjectLint(projectId: string): { settings: LintSettings; source: LintSource } {
  const row = db
    .prepare("SELECT settings_json, preset_id, use_own FROM lint_settings WHERE project_id = ?")
    .get(projectId) as ProjectRow | undefined;

  if (row?.use_own === 1) {
    return { settings: readSettings(row.settings_json) ?? { ...DEFAULT_LINT_SETTINGS }, source: { kind: "own" } };
  }
  if (row?.preset_id) {
    const chosen = presetRow(row.preset_id);
    if (chosen) {
      return {
        settings: readSettings(chosen.settings_json) ?? { ...DEFAULT_LINT_SETTINGS },
        source: { kind: "preset", presetId: chosen.id, presetName: chosen.name },
      };
    }
  }
  const fallback = db.prepare("SELECT * FROM lint_presets WHERE is_default = 1").get() as PresetRow | undefined;
  if (fallback) {
    return {
      settings: readSettings(fallback.settings_json) ?? { ...DEFAULT_LINT_SETTINGS },
      source: { kind: "default", presetId: fallback.id, presetName: fallback.name },
    };
  }
  return { settings: { ...DEFAULT_LINT_SETTINGS }, source: { kind: "builtin" } };
}

/** A project's effective lint settings. */
export function getLintSettings(projectId: string): LintSettings {
  return resolveProjectLint(projectId).settings;
}

/** Checks what an administrator sent. */
export function parseLintSettingsInput(body: unknown): LintSettings {
  const settings = parseLintSettings(body);
  if (!settings) throw new ApiError("LINT_INVALID");
  return settings;
}

/** Saves the project's own version of the settings; from now on it no longer follows a preset. */
export function saveLintSettings(projectId: string, settings: LintSettings, by: string): LintSettings {
  db.prepare(
    `INSERT INTO lint_settings (project_id, settings_json, updated_by_name, updated_at, use_own)
     VALUES (?, ?, ?, datetime('now'), 1)
     ON CONFLICT(project_id) DO UPDATE SET
       settings_json = excluded.settings_json, updated_by_name = excluded.updated_by_name,
       updated_at = excluded.updated_at, use_own = 1`,
  ).run(projectId, JSON.stringify(settings), by);
  return getLintSettings(projectId);
}

/**
 * Makes the project follow a preset (or, with `null`, the instance default).
 * Its own version is dropped.
 */
export function setProjectPreset(projectId: string, presetId: string | null, by: string): void {
  if (presetId !== null && !presetRow(presetId)) throw new ApiError("LINT_PRESET_NOT_FOUND");
  if (presetId === null) {
    db.prepare("DELETE FROM lint_settings WHERE project_id = ?").run(projectId);
    return;
  }
  db.prepare(
    `INSERT INTO lint_settings (project_id, settings_json, updated_by_name, updated_at, preset_id, use_own)
     VALUES (?, ?, ?, datetime('now'), ?, 0)
     ON CONFLICT(project_id) DO UPDATE SET
       settings_json = excluded.settings_json, updated_by_name = excluded.updated_by_name,
       updated_at = excluded.updated_at, preset_id = excluded.preset_id, use_own = 0`,
  ).run(projectId, JSON.stringify(DEFAULT_LINT_SETTINGS), by, presetId);
}
