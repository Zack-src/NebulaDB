import type { FastifyInstance } from "fastify";
import { listErrorLog, recordError, tallyErrorForMetrics } from "../../shared/errorLog.js";
import { ApiError } from "../../shared/errors.js";
import { requireAdmin, requireUser } from "../../shared/guards.js";

/** A caught client render exception is a small, fixed shape — never trust it beyond that. */
const MAX_REPORTED_MESSAGE = 2000;
const MAX_REPORTED_STACK = 8000;
const MAX_REPORTED_CONTEXT = 300;

/** A client can only ever report a handful of these per session (`ErrorBoundary` renders once and stops); this bounds a hostile or looping client instead. */
const CLIENT_ERROR_RATE_LIMIT = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };

export function registerErrorRoutes(app: FastifyInstance): void {
  /**
   * Read-only, admin-only — same shape as `GET /api/audit`. There is
   * deliberately no delete route: like the audit log, this is a record of
   * what happened, not a working set to curate.
   */
  app.get("/api/errors", async (req) => {
    requireAdmin(req);
    const { limit, before, source } = req.query as { limit?: string; before?: string; source?: string };
    const parsedLimit = limit ? Number(limit) : undefined;
    if (parsedLimit !== undefined && !Number.isFinite(parsedLimit)) throw new ApiError("LIMIT_MUST_BE_NUMBER");
    if (source !== undefined && source !== "server" && source !== "client") {
      throw new ApiError("ERROR_LOG_SOURCE_INVALID");
    }
    return listErrorLog({ limit: parsedLimit, before, source: source as "server" | "client" | undefined });
  });

  /**
   * `ErrorBoundary.tsx` posts here on a caught render crash — the one place
   * the client side had nothing at all before this (see `errorLog.ts`'s
   * module comment). Authenticated (an anonymous endpoint that writes to the
   * database on request is its own abuse surface) and rate-limited per the
   * const above; a failure to report is swallowed client-side, never
   * surfaced to the person already looking at a crashed screen.
   */
  app.post("/api/errors/client", CLIENT_ERROR_RATE_LIMIT, async (req, reply) => {
    const user = requireUser(req);
    const body = req.body as { message?: string; stack?: string; context?: string };
    if (!body.message || typeof body.message !== "string") throw new ApiError("CLIENT_ERROR_MESSAGE_REQUIRED");

    tallyErrorForMetrics("client");
    recordError("client", body.message.slice(0, MAX_REPORTED_MESSAGE), {
      stack: typeof body.stack === "string" ? body.stack.slice(0, MAX_REPORTED_STACK) : null,
      context: typeof body.context === "string" ? body.context.slice(0, MAX_REPORTED_CONTEXT) : null,
      user: { id: user.id, email: user.email },
    });
    reply.code(204);
  });
}
