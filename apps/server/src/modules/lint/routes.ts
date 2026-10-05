import type { FastifyInstance } from "fastify";
import { notifyProject } from "../../realtime/roomRegistry.js";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireProjectAccess, requireProjectAdmin } from "../../shared/guards.js";
import { getEffectivePermission } from "../../shared/permissions.js";
import {
  listLintPresetChoices,
  parseLintSettingsInput,
  resolveProjectLint,
  saveLintSettings,
  setProjectPreset,
} from "./repository.js";

/** What the editor needs to lint: the settings that apply, where they come from, and (to those who may choose) the presets on offer. */
function lintState(projectId: string, canChoose: boolean) {
  const { settings, source } = resolveProjectLint(projectId);
  return { settings, source, presets: canChoose ? listLintPresetChoices() : [] };
}

/**
 * The schema linter's settings for one project. Anyone who sees the project
 * reads the settings that apply (the editor lints with them); choosing a
 * preset, keeping a version of its own, and whether an error stops a
 * deployment, are for the project's administrators. The library of presets
 * itself is the instance administrators' (`presetRoutes.ts`).
 */
export function registerLintRoutes(app: FastifyInstance): void {
  app.get("/api/projects/:id/lint", async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requireProjectAccess(req, id, "view");
    return lintState(id, getEffectivePermission(user.id, id) === "administrator");
  });

  app.put("/api/projects/:id/lint", async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requireProjectAdmin(req, id);
    const body = (req.body ?? {}) as { settings?: unknown; presetId?: unknown; profile?: unknown };
    const by = user.displayName ?? user.email;
    // The settings used to be the whole body; that is still accepted.
    const own = body.settings !== undefined ? body.settings : body.profile !== undefined ? req.body : undefined;

    if (own !== undefined) {
      // The project's own version: it stops following a preset.
      const settings = saveLintSettings(id, parseLintSettingsInput(own), by);
      const blocking = settings.blockDeployment ? ", blocks deployment" : "";
      auditUser(
        user,
        "project.lint",
        { type: "project", id },
        `own version: ${settings.profile}${blocking}, ${settings.ignores.length} exception(s), ${settings.customRules.length} custom rule(s)`,
        req,
      );
    } else if (body.presetId === null || typeof body.presetId === "string") {
      // A preset, or `null`: follow the instance default. Its own version, if any, is dropped.
      setProjectPreset(id, body.presetId, by);
      auditUser(
        user,
        "project.lint",
        { type: "project", id },
        body.presetId === null ? "follows the default preset" : `follows preset ${body.presetId}`,
        req,
      );
    } else {
      throw new ApiError("LINT_INVALID");
    }
    notifyProject(id, { type: "lint-changed" });
    return lintState(id, true);
  });
}
