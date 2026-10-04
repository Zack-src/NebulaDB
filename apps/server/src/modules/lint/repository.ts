import { DEFAULT_LINT_SETTINGS, parseLintSettings, type LintSettings } from "@athanordb/dbml-engine";
import { db } from "../../infrastructure/db.js";
import { ApiError } from "../../shared/errors.js";

/** A project's lint settings; the defaults (profile `standard`, nothing blocked) until someone saves others. */
export function getLintSettings(projectId: string): LintSettings {
  const row = db.prepare("SELECT settings_json FROM lint_settings WHERE project_id = ?").get(projectId) as
    { settings_json: string } | undefined;
  // A row written by a version whose rules have since changed is not trusted
  // blindly: it goes through the same check as a request body.
  const stored = row ? parseLintSettings(JSON.parse(row.settings_json)) : null;
  return stored ?? { ...DEFAULT_LINT_SETTINGS };
}

/** Checks what an administrator sent. */
export function parseLintSettingsInput(body: unknown): LintSettings {
  const settings = parseLintSettings(body);
  if (!settings) throw new ApiError("LINT_INVALID");
  return settings;
}

export function saveLintSettings(projectId: string, settings: LintSettings, by: string): LintSettings {
  db.prepare(
    `INSERT INTO lint_settings (project_id, settings_json, updated_by_name, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(project_id) DO UPDATE SET
       settings_json = excluded.settings_json, updated_by_name = excluded.updated_by_name,
       updated_at = excluded.updated_at`,
  ).run(projectId, JSON.stringify(settings), by);
  return getLintSettings(projectId);
}
