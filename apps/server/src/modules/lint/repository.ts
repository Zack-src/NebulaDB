import { randomUUID } from "node:crypto";
import { DEFAULT_LINT_SETTINGS, parseLintSettings, type LintSettings } from "@nebuladb/dbml-engine";
import { db, isUniqueViolation } from "../../infrastructure/db.js";
import { ApiError } from "../../shared/errors.js";
import { mapAsync } from "../../shared/async.js";

/** At most this many presets in the library: a guard against abuse, not a product limit. */
const MAX_LINT_PRESETS = 100;
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

const presetRow = async (id: string) =>
  (await db.prepare("SELECT * FROM lint_presets WHERE id = ?").get(id)) as PresetRow | undefined;

async function followerCount(presetId: string): Promise<number> {
  return (
    (await db.prepare("SELECT COUNT(*) AS n FROM lint_settings WHERE preset_id = ? AND use_own = 0").get(presetId)) as {
      n: number;
    }
  ).n;
}

export async function listLintPresets(): Promise<{ presets: LintPreset[]; defaultId: string | null }> {
  const rows = (await db.prepare("SELECT * FROM lint_presets ORDER BY LOWER(name)").all()) as PresetRow[];
  const presets = await mapAsync(rows, async (row) => toPreset(row, await followerCount(row.id)));
  return { presets, defaultId: presets.find((preset) => preset.isDefault)?.id ?? null };
}

async function getLintPreset(id: string): Promise<LintPreset> {
  const row = await presetRow(id);
  if (!row) throw new ApiError("LINT_PRESET_NOT_FOUND");
  return toPreset(row, await followerCount(id));
}

/** The name and description of a preset, as the project administrators who may pick one see them. */
export async function listLintPresetChoices(): Promise<
  { id: string; name: string; description: string; isDefault: boolean }[]
> {
  return (await listLintPresets()).presets.map(({ id, name, description, isDefault }) => ({
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

const nameTaken = async (name: string, exceptId?: string) =>
  Boolean(
    await db.prepare("SELECT 1 FROM lint_presets WHERE LOWER(name) = LOWER(?) AND id != ?").get(name, exceptId ?? ""),
  );

/**
 * Makes the transaction it is called in the only one changing the library
 * until it ends: the limit, a free name and the single default are each read
 * and then written, and must not be read by two writers at once.
 */
async function lockLibrary(): Promise<void> {
  await db.exec("LOCK TABLE lint_presets IN SHARE ROW EXCLUSIVE MODE");
}

export async function createLintPreset(body: unknown, by: string): Promise<LintPreset> {
  const input = (body ?? {}) as Record<string, unknown>;
  const name = cleanName(input.name);
  const description = cleanDescription(input.description);
  const settings = parseLintSettingsInput(input.settings);
  const id = randomUUID();
  await db.transaction(async () => {
    await lockLibrary();
    const count = ((await db.prepare("SELECT COUNT(*) AS n FROM lint_presets").get()) as { n: number }).n;
    if (count >= MAX_LINT_PRESETS) throw new ApiError("LINT_PRESET_LIMIT");
    if (await nameTaken(name)) throw new ApiError("LINT_PRESET_NAME_TAKEN");
    await db
      .prepare("INSERT INTO lint_presets (id, name, description, settings_json, created_by) VALUES (?, ?, ?, ?, ?)")
      .run(id, name, description, JSON.stringify(settings), by);
  });
  return await getLintPreset(id);
}

/** Changes a preset; `affected` are the projects whose effective settings just changed. */
export async function updateLintPreset(id: string, body: unknown): Promise<{ preset: LintPreset; affected: string[] }> {
  const row = await presetRow(id);
  if (!row) throw new ApiError("LINT_PRESET_NOT_FOUND");
  const input = (body ?? {}) as Record<string, unknown>;
  const name = input.name === undefined ? row.name : cleanName(input.name);
  const description = input.description === undefined ? row.description : cleanDescription(input.description);
  const settings =
    input.settings === undefined ? row.settings_json : JSON.stringify(parseLintSettingsInput(input.settings));
  if (name !== row.name && (await nameTaken(name, id))) throw new ApiError("LINT_PRESET_NAME_TAKEN");
  try {
    await db
      .prepare(
        "UPDATE lint_presets SET name = ?, description = ?, settings_json = ?, updated_at = utc_now() WHERE id = ?",
      )
      .run(name, description, settings, id);
  } catch (err) {
    // Taken between the look above and this update.
    if (isUniqueViolation(err, "idx_lint_presets_name")) throw new ApiError("LINT_PRESET_NAME_TAKEN");
    throw err;
  }
  return { preset: await getLintPreset(id), affected: input.settings === undefined ? [] : await projectsFollowing(id) };
}

/** Deletes a preset; the projects that followed it fall back to the default. */
export async function deleteLintPreset(id: string): Promise<{ detached: string[] }> {
  const row = await presetRow(id);
  if (!row) throw new ApiError("LINT_PRESET_NOT_FOUND");
  const detached = await projectsFollowing(id);
  await db.transaction(async () => {
    await db.prepare("UPDATE lint_settings SET preset_id = NULL WHERE preset_id = ?").run(id);
    await db.prepare("DELETE FROM lint_presets WHERE id = ?").run(id);
  });
  return { detached };
}

/** Makes a preset the instance default, or with `null` removes the default. */
export async function setDefaultLintPreset(
  id: string | null,
): Promise<{ defaultId: string | null; affected: string[] }> {
  await db.transaction(async () => {
    await lockLibrary();
    if (id !== null && !(await presetRow(id))) throw new ApiError("LINT_PRESET_NOT_FOUND");
    await db.prepare("UPDATE lint_presets SET is_default = 0 WHERE is_default = 1").run();
    if (id !== null) await db.prepare("UPDATE lint_presets SET is_default = 1 WHERE id = ?").run(id);
  });
  // Who follows "the default" does not depend on which preset it is: all of them see their rules change.
  return { defaultId: id, affected: await defaultFollowers() };
}

/**
 * Points projects at a preset. The settings a project had of its own are
 * dropped: it follows the preset from now on. Unknown project ids are skipped.
 */
export async function applyLintPreset(
  presetId: string,
  projectIds: unknown,
  by: string,
): Promise<{ applied: string[]; skipped: string[] }> {
  if (!(await presetRow(presetId))) throw new ApiError("LINT_PRESET_NOT_FOUND");
  if (!Array.isArray(projectIds) || projectIds.length > 200 || projectIds.some((id) => typeof id !== "string")) {
    throw new ApiError("LINT_INVALID");
  }
  const applied: string[] = [];
  const skipped: string[] = [];
  await db.transaction(async () => {
    for (const id of new Set(projectIds as string[])) {
      if (!(await db.prepare("SELECT 1 FROM projects WHERE id = ?").get(id))) {
        skipped.push(id);
        continue;
      }
      await setProjectPreset(id, presetId, by);
      applied.push(id);
    }
  });
  return { applied, skipped };
}

/** The projects that follow `presetId` explicitly. */
async function projectsFollowing(presetId: string): Promise<string[]> {
  const explicit = (await db
    .prepare("SELECT project_id AS id FROM lint_settings WHERE preset_id = ? AND use_own = 0")
    .all(presetId)) as { id: string }[];
  const ids = new Set(explicit.map((row) => row.id));
  const row = await presetRow(presetId);
  if (row?.is_default === 1) for (const id of await defaultFollowers()) ids.add(id);
  return [...ids];
}

/** Projects that fall back to the instance default: no version of their own and no (existing) preset chosen. */
async function defaultFollowers(): Promise<string[]> {
  return (
    (await db
      .prepare(
        `SELECT p.id AS id FROM projects p LEFT JOIN lint_settings l ON l.project_id = p.id
         WHERE COALESCE(l.use_own, 0) = 0
           AND (l.preset_id IS NULL OR l.preset_id NOT IN (SELECT id FROM lint_presets))`,
      )
      .all()) as { id: string }[]
  ).map((row) => row.id);
}

/**
 * A project's settings as they apply: its own version when it has one, else the
 * preset chosen for it, else the instance default preset, else the built-in
 * defaults. The one place this is decided — the editor, the API and the
 * deployment check all read it.
 */
export async function resolveProjectLint(projectId: string): Promise<{ settings: LintSettings; source: LintSource }> {
  const row = (await db
    .prepare("SELECT settings_json, preset_id, use_own FROM lint_settings WHERE project_id = ?")
    .get(projectId)) as ProjectRow | undefined;

  if (row?.use_own === 1) {
    return { settings: readSettings(row.settings_json) ?? { ...DEFAULT_LINT_SETTINGS }, source: { kind: "own" } };
  }
  if (row?.preset_id) {
    const chosen = await presetRow(row.preset_id);
    if (chosen) {
      return {
        settings: readSettings(chosen.settings_json) ?? { ...DEFAULT_LINT_SETTINGS },
        source: { kind: "preset", presetId: chosen.id, presetName: chosen.name },
      };
    }
  }
  const fallback = (await db.prepare("SELECT * FROM lint_presets WHERE is_default = 1").get()) as PresetRow | undefined;
  if (fallback) {
    return {
      settings: readSettings(fallback.settings_json) ?? { ...DEFAULT_LINT_SETTINGS },
      source: { kind: "default", presetId: fallback.id, presetName: fallback.name },
    };
  }
  return { settings: { ...DEFAULT_LINT_SETTINGS }, source: { kind: "builtin" } };
}

/** A project's effective lint settings. */
export async function getLintSettings(projectId: string): Promise<LintSettings> {
  return (await resolveProjectLint(projectId)).settings;
}

/** Checks what an administrator sent. */
export function parseLintSettingsInput(body: unknown): LintSettings {
  const settings = parseLintSettings(body);
  if (!settings) throw new ApiError("LINT_INVALID");
  return settings;
}

/** Saves the project's own version of the settings; from now on it no longer follows a preset. */
export async function saveLintSettings(projectId: string, settings: LintSettings, by: string): Promise<LintSettings> {
  await db
    .prepare(
      `INSERT INTO lint_settings (project_id, settings_json, updated_by_name, updated_at, use_own)
     VALUES (?, ?, ?, utc_now(), 1)
     ON CONFLICT(project_id) DO UPDATE SET
       settings_json = excluded.settings_json, updated_by_name = excluded.updated_by_name,
       updated_at = excluded.updated_at, use_own = 1`,
    )
    .run(projectId, JSON.stringify(settings), by);
  return await getLintSettings(projectId);
}

/**
 * Makes the project follow a preset (or, with `null`, the instance default).
 * Its own version is dropped.
 */
export async function setProjectPreset(projectId: string, presetId: string | null, by: string): Promise<void> {
  if (presetId !== null && !(await presetRow(presetId))) throw new ApiError("LINT_PRESET_NOT_FOUND");
  if (presetId === null) {
    await db.prepare("DELETE FROM lint_settings WHERE project_id = ?").run(projectId);
    return;
  }
  await db
    .prepare(
      `INSERT INTO lint_settings (project_id, settings_json, updated_by_name, updated_at, preset_id, use_own)
     VALUES (?, ?, ?, utc_now(), ?, 0)
     ON CONFLICT(project_id) DO UPDATE SET
       settings_json = excluded.settings_json, updated_by_name = excluded.updated_by_name,
       updated_at = excluded.updated_at, preset_id = excluded.preset_id, use_own = 0`,
    )
    .run(projectId, JSON.stringify(DEFAULT_LINT_SETTINGS), by, presetId);
}
