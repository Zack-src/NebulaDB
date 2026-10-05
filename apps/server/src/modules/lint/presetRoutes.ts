import type { FastifyInstance } from "fastify";
import { notifyProject } from "../../realtime/roomRegistry.js";
import { auditUser } from "../../shared/audit.js";
import { requireAdmin } from "../../shared/guards.js";
import {
  applyLintPreset,
  createLintPreset,
  deleteLintPreset,
  listLintPresets,
  setDefaultLintPreset,
  updateLintPreset,
} from "./repository.js";

const WRITE_LIMIT = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };

/** Tells the editors open on `projectIds` that the rules they lint with changed. */
const notifyRulesChanged = (projectIds: string[]) => {
  for (const id of projectIds) notifyProject(id, { type: "lint-changed" });
};

/**
 * The library of lint presets (Admin → Lint). Instance administrators only:
 * a preset is a rule set that projects follow, and the one marked default
 * applies to every project that picked nothing. Nothing here exposes a
 * project's content — only how many follow a preset.
 */
export function registerLintPresetRoutes(app: FastifyInstance): void {
  app.get("/api/admin/lint-presets", async (req) => {
    requireAdmin(req);
    return listLintPresets();
  });

  app.post("/api/admin/lint-presets", WRITE_LIMIT, async (req, reply) => {
    const user = requireAdmin(req);
    const preset = createLintPreset(req.body, user.displayName ?? user.email);
    auditUser(user, "lint.preset.create", { type: "lint-preset", id: preset.id }, preset.name, req);
    reply.code(201);
    return { preset };
  });

  // Declared before `/:id` routes so "default" is never read as an id.
  app.put("/api/admin/lint-presets/default", WRITE_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const id = ((req.body ?? {}) as { id?: unknown }).id;
    const result = setDefaultLintPreset(typeof id === "string" ? id : null);
    auditUser(user, "lint.preset.default", { type: "lint-preset", id: result.defaultId ?? "none" }, undefined, req);
    notifyRulesChanged(result.affected);
    return { defaultId: result.defaultId };
  });

  app.put("/api/admin/lint-presets/:id", WRITE_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const { id } = req.params as { id: string };
    const { preset, affected } = updateLintPreset(id, req.body);
    auditUser(
      user,
      "lint.preset.update",
      { type: "lint-preset", id },
      `${preset.name}, ${affected.length} project(s) follow it`,
      req,
    );
    notifyRulesChanged(affected);
    return { preset };
  });

  app.delete("/api/admin/lint-presets/:id", WRITE_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const { id } = req.params as { id: string };
    const { detached } = deleteLintPreset(id);
    auditUser(user, "lint.preset.delete", { type: "lint-preset", id }, `${detached.length} project(s) detached`, req);
    notifyRulesChanged(detached);
    return { ok: true, detached: detached.length };
  });

  app.post("/api/admin/lint-presets/:id/apply", WRITE_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const { id } = req.params as { id: string };
    const { projectIds } = (req.body ?? {}) as { projectIds?: unknown };
    const { applied, skipped } = applyLintPreset(id, projectIds, user.displayName ?? user.email);
    auditUser(user, "lint.preset.apply", { type: "lint-preset", id }, `${applied.length} project(s)`, req);
    notifyRulesChanged(applied);
    return { applied: applied.length, skipped };
  });
}
