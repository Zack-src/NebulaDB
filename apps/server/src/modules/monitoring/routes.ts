import type { FastifyInstance, FastifyRequest } from "fastify";
import type { DriftEvent, MonitorSettings } from "@nebuladb/shared";
import { auditUser } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin, requireProjectAccess, requireProjectAdmin, requireUser } from "../../shared/guards.js";
import { notifyProject } from "../../realtime/roomRegistry.js";
import { getProjectRow } from "../projects/repository.js";
import {
  acceptAccountState,
  accountWatchState,
  isAccountWatchOn,
  registerAccountWatchHooks,
  setAccountWatch,
} from "./accountWatch.js";
import { checkProjectMonitoring } from "./monitor.js";
import {
  acknowledgeDriftEvent,
  clearMute,
  getDriftEvent,
  getMonitorSettings,
  listDriftEvents,
  parseMonitorSettings,
  parseMute,
  saveMonitorSettings,
  setMute,
} from "./repository.js";

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

const MAX_NOTE = 500;

type RouteUser = { id: string; email: string; displayName: string; isAdmin: boolean };

/**
 * Holds the watch's alerts back for a while: checks go on and events are still recorded and
 * listed, but nothing is notified, e-mailed or sent to a webhook. A watch imposed from a connection
 * is not the project's to silence — only an instance administrator may, or muting would be a way
 * around the imposition. Audited, with the reason.
 */
export function muteAlertsFor(user: RouteUser, projectId: string, body: unknown, req: FastifyRequest): MonitorSettings {
  if (getMonitorSettings(projectId).forced && !user.isAdmin) throw new ApiError("MONITORING_MUTE_LOCKED");
  const { minutes, reason } = parseMute(body);
  const mute = setMute(projectId, minutes, reason, user.displayName);
  auditUser(user, "monitoring.mute", { type: "project", id: projectId }, `until ${mute.until} UTC: ${reason}`, req);
  return getMonitorSettings(projectId);
}

/** Lifts the mute — always open to a project administrator: it only brings the alerts back. */
export function unmuteAlertsFor(user: RouteUser, projectId: string, req: FastifyRequest): MonitorSettings {
  if (clearMute(projectId)) auditUser(user, "monitoring.unmute", { type: "project", id: projectId }, undefined, req);
  return getMonitorSettings(projectId);
}

/**
 * A project administrator takes note of an open finding: who and when are recorded with an
 * optional note, the finding stays open. The accounts watch's findings are the instance
 * administrators' to see, hence to acknowledge — for anyone else they do not exist.
 */
export function acknowledgeEventFor(
  user: { id: string; email: string; displayName: string; isAdmin: boolean },
  projectId: string,
  eventId: string,
  body: unknown,
  req: FastifyRequest,
): DriftEvent {
  const raw = ((body ?? {}) as { note?: unknown }).note;
  if (raw !== undefined && raw !== null && (typeof raw !== "string" || raw.length > MAX_NOTE)) {
    throw new ApiError("MONITORING_INVALID");
  }
  const note = typeof raw === "string" && raw.trim() ? raw.trim() : null;
  const event = getDriftEvent(projectId, eventId);
  if (!event || (event.kind === "accounts" && !user.isAdmin)) throw new ApiError("MONITORING_EVENT_NOT_FOUND");
  if (!acknowledgeDriftEvent(projectId, eventId, user.displayName, note))
    throw new ApiError("MONITORING_EVENT_NOT_OPEN");
  auditUser(
    user,
    "monitoring.acknowledge",
    { type: "connection", id: event.connectionId },
    `${event.kind}${note ? `: ${note}` : ""}`,
    req,
    { projectId },
  );
  // The editor's banner of the people who are not administrators goes at once.
  notifyProject(projectId, { type: "drift-changed" });
  return getDriftEvent(projectId, eventId)!;
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

  app.put("/api/projects/:id/monitoring/mute", async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requireProjectAdmin(req, id);
    return { settings: muteAlertsFor(user, id, req.body, req) };
  });

  app.delete("/api/projects/:id/monitoring/mute", async (req) => {
    const { id } = req.params as { id: string };
    const { user } = requireProjectAdmin(req, id);
    return { settings: unmuteAlertsFor(user, id, req) };
  });

  app.post("/api/projects/:id/monitoring/events/:eventId/acknowledge", async (req) => {
    const { id, eventId } = req.params as { id: string; eventId: string };
    const { user } = requireProjectAdmin(req, id);
    acknowledgeEventFor(user, id, eventId, req.body, req);
    return monitoringView(req, id);
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
