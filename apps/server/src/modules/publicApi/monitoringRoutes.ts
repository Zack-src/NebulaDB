import type { FastifyInstance } from "fastify";
import { requireScope } from "../apiKeys/auth.js";
import { requireProjectAccess, requireProjectAdmin } from "../../shared/guards.js";
import { checkProjectMonitoring } from "../monitoring/monitor.js";
import { getMonitorSettings, listDriftEvents } from "../monitoring/repository.js";
import { acknowledgeEventFor, muteAlertsFor, saveMonitoringFor, unmuteAlertsFor } from "../monitoring/routes.js";
import { API_RATE_LIMIT, DEPLOY_RATE_LIMIT } from "./rateLimits.js";
import { parseParams, idParams, paramsOf } from "../../shared/validate.js";

const idEventIdParams = paramsOf("id", "eventId");

/**
 * The watch over a project's databases under `/api/v1`, with the app's own
 * rules (`monitoring/routes.ts`): anyone who sees the project reads what was
 * found, its administrators set the watch and run a check — which opens a
 * connection to each database, hence the deployment rate limit.
 */
export function registerPublicMonitoringRoutes(app: FastifyInstance): void {
  app.get("/api/v1/projects/:id/monitoring", API_RATE_LIMIT, async (req) => {
    const { id } = parseParams(idParams, req);
    await requireProjectAccess(req, id, "view");
    requireScope(req, "projects:read", id);
    return { settings: await getMonitorSettings(id), events: await listDriftEvents(id) };
  });

  app.put("/api/v1/projects/:id/monitoring", API_RATE_LIMIT, async (req) => {
    const { id } = parseParams(idParams, req);
    const { user } = await requireProjectAdmin(req, id);
    requireScope(req, "projects:write", id);
    return { settings: await saveMonitoringFor(user, id, req.body, req) };
  });

  // Reads every database of the project now, whatever the watch's own pace — what a CI job calls before promoting.
  app.post("/api/v1/projects/:id/monitoring/check", DEPLOY_RATE_LIMIT, async (req) => {
    const { id } = parseParams(idParams, req);
    await requireProjectAccess(req, id, "deploy");
    requireScope(req, "projects:read", id);
    const result = await checkProjectMonitoring(id);
    return { result, settings: await getMonitorSettings(id), events: await listDriftEvents(id) };
  });

  // Holds the alerts back for a while (a maintenance window a CI job opens); lifting it is `DELETE`.
  app.put("/api/v1/projects/:id/monitoring/mute", API_RATE_LIMIT, async (req) => {
    const { id } = parseParams(idParams, req);
    const { user } = await requireProjectAdmin(req, id);
    requireScope(req, "projects:write", id);
    return { settings: await muteAlertsFor(user, id, req.body, req) };
  });

  app.delete("/api/v1/projects/:id/monitoring/mute", API_RATE_LIMIT, async (req) => {
    const { id } = parseParams(idParams, req);
    const { user } = await requireProjectAdmin(req, id);
    requireScope(req, "projects:write", id);
    return { settings: await unmuteAlertsFor(user, id, req) };
  });

  // Takes note of an open finding: it stays open, shows who is on it and quiets the editor's banner for non-administrators.
  app.post("/api/v1/projects/:id/monitoring/events/:eventId/acknowledge", API_RATE_LIMIT, async (req) => {
    const { id, eventId } = parseParams(idEventIdParams, req);
    const { user } = await requireProjectAdmin(req, id);
    requireScope(req, "projects:write", id);
    return { event: await acknowledgeEventFor(user, id, eventId, req.body, req) };
  });
}
