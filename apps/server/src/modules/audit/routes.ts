import type { FastifyInstance } from "fastify";
import { listAuditLog } from "../../shared/audit.js";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin } from "../../shared/guards.js";

/**
 * Read-only view of the audit trail, admin-only.
 *
 * There is deliberately no write route and no delete route: entries are
 * produced by the actions themselves (see `audit.ts`), and an API that let an
 * administrator edit the record of what administrators did would defeat the
 * point of keeping one.
 */
export function registerAuditRoutes(app: FastifyInstance): void {
  app.get("/api/audit", async (req) => {
    requireAdmin(req);
    const { limit, before, action, targetId } = req.query as {
      limit?: string;
      before?: string;
      action?: string;
      targetId?: string;
    };
    const parsedLimit = limit ? Number(limit) : undefined;
    if (parsedLimit !== undefined && !Number.isFinite(parsedLimit)) throw new ApiError("LIMIT_MUST_BE_NUMBER");
    return listAuditLog({ limit: parsedLimit, before, action, targetId });
  });
}
