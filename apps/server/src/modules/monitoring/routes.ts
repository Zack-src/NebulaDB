import type { FastifyInstance, FastifyRequest } from "fastify";
import type { MonitorSettings } from "@nebuladb/shared";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin, requireProjectAccess, requireProjectAdmin, requireUser } from "../../shared/guards.js";
import { getProjectRow } from "../projects/repository.js";
import {
  acceptAccountState,
  accountWatchState,
  isAccountWatchOn,
  registerAccountWatchHooks,
  setAccountWatch,
} from "./accountWatch.js";
import { checkProjectMonitoring } from "./monitor.js";
import { getMonitorSettings, listDriftEvents, parseMonitorSettings, saveMonitorSettings } from "./repository.js";

const CHECK_LIMIT = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

/**
 * Saves what an administrator chose for the watch; switching it on or off, or changing its pace, is audited.
 * A watch imposed from a connection is the instance administrators' alone, and only its ignored tables change here.
 */
export function saveMonitoringFor(
  user: { id: string; email: string; displayName: string; isAdmin: boolean },
  projectId: string,
  body: unknown,
  req: FastifyRequest,
): MonitorSettings {
  const before = getMonitorSettings(projectId);
  // Otherwise ignoring every table would switch off what the connection imposes.
  if (before.forced && !user.isAdmin) throw new ApiError("MONITORING_LOCKED");
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
  registerAccountWatchHooks(app);

  /**
   * The watch as the caller may see it. The accounts watch names the
   * database's accounts — the console's "Utilisateurs" tab is the instance
   * administrators' — so its state and findings are theirs only.
   */
  const monitoringView = (req: FastifyRequest, id: string) => {
    const admin = requireUser(req).isAdmin;
    return {
      settings: getMonitorSettings(id),
      events: listDriftEvents(id, 50, admin),
      accounts: admin ? accountWatchState(id, true) : null,
    };
  };

  app.get("/api/projects/:id/monitoring", async (req) => {
    const { id } = req.params as { id: string };
    requireProjectAccess(req, id, "view");
    return monitoringView(req, id);
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
    return { result, ...monitoringView(req, id) };
  });

  // Turning the accounts watch on or off: instance administrators only.
  app.put("/api/projects/:id/monitoring/accounts", async (req) => {
    const user = requireAdmin(req);
    const { id } = req.params as { id: string };
    if (!getProjectRow(id)) throw new ApiError("NOT_FOUND");
    const { enabled } = (req.body ?? {}) as { enabled?: unknown };
    if (typeof enabled !== "boolean") throw new ApiError("MONITORING_INVALID");
    if (isAccountWatchOn(id) !== enabled) {
      setAccountWatch(id, enabled);
      auditUser(user, "monitoring.accounts.watch", { type: "project", id }, enabled ? "on" : "off", req);
    }
    return monitoringView(req, id);
  });

  // "This is how it should be": the state last read becomes the reference.
  app.post("/api/projects/:id/monitoring/accounts/accept", CHECK_LIMIT, async (req) => {
    const user = requireAdmin(req);
    const { id } = req.params as { id: string };
    if (!getProjectRow(id)) throw new ApiError("NOT_FOUND");
    const { connectionId } = (req.body ?? {}) as { connectionId?: unknown };
    if (typeof connectionId !== "string" || !acceptAccountState(id, connectionId)) {
      throw new ApiError("MONITORING_INVALID");
    }
    auditUser(user, "monitoring.accounts.accept", { type: "connection", id: connectionId }, undefined, req, {
      projectId: id,
    });
    return monitoringView(req, id);
  });
}
