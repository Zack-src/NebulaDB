import type { FastifyInstance } from "fastify";
import { listAuditLog } from "../audit.js";
import { requireAdmin } from "../auth/session.js";

/**
 * Read-only view of the audit trail, admin-only.
 *
 * There is deliberately no write route and no delete route: entries are
 * produced by the actions themselves (see `audit.ts`), and an API that let an
 * administrator edit the record of what administrators did would defeat the
 * point of keeping one.
 */
export function registerAuditRoutes(app: FastifyInstance): void {
  app.get("/api/audit", async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const { limit, before, action, targetId } = req.query as {
      limit?: string;
      before?: string;
      action?: string;
      targetId?: string;
    };
    const parsedLimit = limit ? Number(limit) : undefined;
    if (parsedLimit !== undefined && !Number.isFinite(parsedLimit)) {
      reply.code(400);
      return { error: "limit must be a number" };
    }
    return listAuditLog({ limit: parsedLimit, before, action, targetId });
  });
}
