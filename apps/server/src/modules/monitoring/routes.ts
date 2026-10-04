import type { FastifyInstance, FastifyRequest } from "fastify";
import type { MonitorSettings } from "@athanordb/shared";
import { auditUser } from "../../shared/audit.js";
import { requireProjectAccess, requireProjectAdmin } from "../../shared/guards.js";
import { checkProjectMonitoring } from "./monitor.js";
import { getMonitorSettings, listDriftEvents, parseMonitorSettings, saveMonitorSettings } from "./repository.js";

const CHECK_LIMIT = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

/** Saves what an administrator chose for the watch; switching it on or off, or changing its pace, is audited. */
export function saveMonitoringFor(
  user: { id: string; email: string; displayName: string },
  projectId: string,
  body: unknown,
  req: FastifyRequest,
): MonitorSettings {
  const before = getMonitorSettings(projectId);
  const settings = saveMonitorSettings(projectId, parseMonitorSettings(body), user.displayName);
  if (before.enabled !== settings.enabled || before.intervalMinutes !== settings.intervalMinutes) {
    auditUser(
      user,
      "project.monitoring",
      { type: "project", id: projectId },
      settings.enabled ? `on, every ${settings.intervalMinutes} min` : "off",
      req,
    );
  }
  return settings;
}

/**
 * The watch over a project's databases. Turning it on, off or changing how it
 * looks is for the project's administrators — it opens connections to their
 * databases on a schedule. What it found is readable by anyone who sees the
 * project (the banner already tells them).
 */
export function registerMonitoringRoutes(app: FastifyInstance): void {
  app.get("/api/projects/:id/monitoring", async (req) => {
    const { id } = req.params as { id: string };
    requireProjectAccess(req, id, "view");
    return { settings: getMonitorSettings(id), events: listDriftEvents(id) };
  });

  app.put("/api/projects/:id/monitoring", async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requireProjectAdmin(req, id);
    return { settings: saveMonitoringFor(user, id, req.body, req) };
  });

  app.post("/api/projects/:id/monitoring/check", CHECK_LIMIT, async (req) => {
    const { id } = req.params as { id: string };
    requireProjectAdmin(req, id);
    const result = await checkProjectMonitoring(id);
    return { result, settings: getMonitorSettings(id), events: listDriftEvents(id) };
  });
}
