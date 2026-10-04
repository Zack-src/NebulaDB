import type { FastifyInstance } from "fastify";
import { requireGlobalScope } from "../apiKeys/auth.js";
import { requireAdmin } from "../../shared/guards.js";
import {
  cancelRunningBackup,
  connectionBackups,
  downloadBackup,
  removeBackup,
  requireBackup,
  startManualBackup,
} from "../backups/service.js";
import { API_RATE_LIMIT, DEPLOY_RATE_LIMIT } from "./rateLimits.js";

/**
 * Backups of a connected database under `/api/v1`: the app's own rules
 * (`backups/service.ts`, instance administrators only) behind the scope
 * `connections:manage`. A connection is an instance-level object and a backup
 * is every row of its database, so — like the team routes — these use
 * `requireGlobalScope`: a key restricted to one project is refused outright.
 *
 * No restore here, deliberately: it empties tables, and the app makes the
 * person retype the target's name before it does. A script takes backups and
 * fetches them; putting one back stays a decision made in front of the screen.
 */
export function registerPublicBackupRoutes(app: FastifyInstance): void {
  app.get("/api/v1/connections/:id/backups", API_RATE_LIMIT, async (req) => {
    requireAdmin(req);
    requireGlobalScope(req, "connections:manage");
    const { id } = req.params as { id: string };
    return connectionBackups(id);
  });

  // Answers as soon as the backup has started; `GET /api/v1/backups/:id` says how far it is.
  // Reads whole tables of someone's database, hence the deployment rate limit — as the download, which sends them.
  app.post("/api/v1/connections/:id/backups", DEPLOY_RATE_LIMIT, async (req, reply) => {
    const user = requireAdmin(req);
    requireGlobalScope(req, "connections:manage");
    const { id } = req.params as { id: string };
    return reply.code(202).send({ backup: startManualBackup(user, id, req.body, req) });
  });

  // What a script polls until `status` is no longer `running`.
  app.get("/api/v1/backups/:id", API_RATE_LIMIT, async (req) => {
    requireAdmin(req);
    requireGlobalScope(req, "connections:manage");
    const { id } = req.params as { id: string };
    return { backup: requireBackup(id) };
  });

  app.post("/api/v1/backups/:id/cancel", API_RATE_LIMIT, async (req) => {
    requireAdmin(req);
    requireGlobalScope(req, "connections:manage");
    const { id } = req.params as { id: string };
    cancelRunningBackup(id);
    return { cancelling: true };
  });

  app.delete("/api/v1/backups/:id", API_RATE_LIMIT, async (req) => {
    const user = requireAdmin(req);
    requireGlobalScope(req, "connections:manage");
    const { id } = req.params as { id: string };
    removeBackup(user, id, req);
    return { deleted: true };
  });

  app.get("/api/v1/backups/:id/download", DEPLOY_RATE_LIMIT, async (req, reply) => {
    const user = requireAdmin(req);
    requireGlobalScope(req, "connections:manage");
    const { id } = req.params as { id: string };
    const { fileName, stream } = await downloadBackup(user, id, req);
    return reply
      .header("content-type", "application/gzip")
      .header("content-disposition", `attachment; filename="${fileName}"`)
      .send(stream);
  });
}
