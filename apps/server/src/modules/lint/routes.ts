import type { FastifyInstance } from "fastify";
import { notifyProject } from "../../realtime/roomRegistry.js";
import { auditUser } from "../../shared/audit.js";
import { requireProjectAccess, requireProjectAdmin } from "../../shared/guards.js";
import { getLintSettings, parseLintSettingsInput, saveLintSettings } from "./repository.js";

/**
 * The schema linter's settings. Anyone who sees the project reads them (the
 * editor lints with them); choosing the rules — and whether an error stops a
 * deployment — is for the project's administrators.
 */
export function registerLintRoutes(app: FastifyInstance): void {
  app.get("/api/projects/:id/lint", async (req) => {
    const { id } = req.params as { id: string };
    requireProjectAccess(req, id, "view");
    return { settings: getLintSettings(id) };
  });

  app.put("/api/projects/:id/lint", async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requireProjectAdmin(req, id);
    const settings = saveLintSettings(id, parseLintSettingsInput(req.body), user.displayName);
    const blocking = settings.blockDeployment ? ", blocks deployment" : "";
    auditUser(
      user,
      "project.lint",
      { type: "project", id },
      `${settings.profile}${blocking}, ${settings.ignores.length} exception(s)`,
      req,
    );
    notifyProject(id, { type: "lint-changed" });
    return { settings };
  });
}
