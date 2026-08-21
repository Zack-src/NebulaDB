import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { config } from "./config.js";
import { db } from "./infrastructure/db.js";
import { registerAuditRoutes } from "./modules/audit/routes.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { registerTotpRoutes } from "./modules/auth/totpRoutes.js";
import { resolveSession } from "./modules/auth/session.js";
import { registerConvertRoutes } from "./modules/convert/routes.js";
import { registerConnectionRoutes } from "./modules/connections/routes.js";
import { registerErrorRoutes } from "./modules/errors/routes.js";
import { registerInvitationRoutes } from "./modules/invitations/routes.js";
import { registerProjectRoutes } from "./modules/projects/index.js";
import { getProjectRow } from "./modules/projects/repository.js";
import { registerTeamRoutes } from "./modules/teams/routes.js";
import { registerUserRoutes } from "./modules/users/index.js";
import { getRoom, liveRoomCount, setRoomLogger } from "./realtime/roomRegistry.js";
import { renderPrometheusMetrics } from "./infrastructure/metrics.js";
import { ApiError, registerErrorHandler } from "./shared/errors.js";
import { getEffectivePermission } from "./shared/permissions.js";

/**
 * Builds the Fastify instance with every plugin, hook and route registered —
 * everything `index.ts` needs *before* it starts accepting real traffic, and
 * nothing after: no `.listen()`, no session-sweep/backup timers, no signal
 * handlers. Split out from `index.ts` (which used to do all of this as
 * top-level side effects at import time, `.listen()` included) so a test can
 * `await buildApp()` and drive it with `.inject()` — no real socket, no
 * timers left running past the test, no process-level handlers registered
 * twice if more than one test file imports it.
 */
export async function buildApp(): Promise<FastifyInstance> {
  // `bodyLimit` bounds REST payloads (the DBML/SQL import route is the big one);
  // `maxPayload` bounds a single WebSocket frame, which was previously unbounded
  // — a client could send an arbitrarily large Yjs update and the server would
  // buffer all of it.
  const app = Fastify({
    logger: {
      level: config.logLevel,
      // Defence in depth, not a fix for a current leak: Fastify's default
      // request serializer logs method/url/host/remoteAddress and no headers, so
      // the session cookie doesn't reach the log today (verified against a
      // running server — the issued session id appears zero times in its
      // output). This makes that hold if anyone later logs a full `req`/`res`,
      // where the cookie *is* the credential and a log line containing it is a
      // log line someone can log in with.
      redact: {
        paths: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]'],
        censor: "[redacted]",
      },
    },
    bodyLimit: config.bodyLimit,
  });
  registerErrorHandler(app);
  // Every `Room` logs through this from here on instead of bare `console` —
  // set before the WS route below can create the first one. See
  // `realtime/room/logger.ts` for what this does (and doesn't) buy in terms
  // of correlation.
  setRoomLogger(app.log);
  await app.register(websocket, { options: { maxPayload: config.wsMaxPayload } });
  await app.register(fastifyCookie);
  // Global ceiling, deliberately loose — the collaborative UI is chatty. The
  // routes that actually need protecting set their own much tighter limits.
  await app.register(fastifyRateLimit, {
    global: false,
    max: 300,
    timeWindow: "1 minute",
  });

  // Resolves the session cookie into `req.user` for every request but never
  // rejects here — public routes (login, health, invite-accept once it exists)
  // need to stay reachable. Each route that requires a user calls
  // `requireUser`/`requireAdmin` itself (see auth/session.ts).
  app.addHook("onRequest", async (req, reply) => {
    req.user = resolveSession(req, reply);
  });

  const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

  /**
   * Second layer of CSRF defence. Sessions are cookie-based and the cookie is
   * `SameSite=Lax`, which already blocks cross-site POSTs from a page — but that
   * is the *only* thing standing between a hostile page and a state-changing
   * request, and it depends entirely on browser behaviour. So: when a
   * state-changing request carries an `Origin`, that origin must match the host
   * the request was made to (or be listed in ATHANORDB_ALLOWED_ORIGINS).
   *
   * A missing `Origin` is allowed through — non-browser clients (curl, scripts,
   * the backup tooling) don't send one, and browsers always do for cross-origin
   * state-changing requests, which is the case that matters.
   */
  app.addHook("onRequest", async (req) => {
    if (SAFE_METHODS.has(req.method)) return;
    const origin = req.headers.origin;
    if (!origin || origin === "null") return;

    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new ApiError("ORIGIN_INVALID");
    }
    if (originHost === req.headers.host) return;
    if (config.allowedOrigins.includes(origin.replace(/\/$/, ""))) return;

    req.log.warn({ origin, host: req.headers.host }, "rejected cross-origin state-changing request");
    throw new ApiError("ORIGIN_MISMATCH");
  });

  /**
   * Health check with something to fail on. It used to return `{status:"ok"}`
   * unconditionally, which meant the Dockerfile's HEALTHCHECK could only ever
   * detect a dead process — a database locked, deleted out from under the
   * process, or otherwise unreadable would still report healthy while every
   * request failed.
   *
   * The query is intentionally trivial (a count against a table that always
   * exists): this runs on an interval forever, and the point is to prove the
   * connection still works, not to measure anything.
   */
  app.get("/api/health", async (_req, reply) => {
    try {
      const row = db.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number };
      return {
        status: "ok",
        projects: row.n,
        rooms: liveRoomCount(),
        uptimeSeconds: Math.round(process.uptime()),
      };
    } catch (err) {
      app.log.error({ err }, "health check failed");
      reply.code(503);
      return { status: "error", ...new ApiError("DATABASE_UNAVAILABLE").toPayload() };
    }
  });
  /**
   * Prometheus-format metrics — connection/room counts, hot-path timing
   * (snapshot-write latency included), error counts since boot. See
   * `infrastructure/metrics.ts`. Same "no auth, same as /api/health" reasoning
   * documented there.
   */
  app.get("/api/metrics", async (_req, reply) => {
    reply.type("text/plain; version=0.0.4");
    return renderPrometheusMetrics();
  });

  registerAuthRoutes(app);
  registerTotpRoutes(app);
  registerInvitationRoutes(app);
  registerUserRoutes(app);
  registerTeamRoutes(app);
  registerProjectRoutes(app);
  registerConvertRoutes(app);
  registerConnectionRoutes(app);
  registerAuditRoutes(app);
  registerErrorRoutes(app);

  // Single-process production deployment: serve the built web app once it
  // exists. In dev, apps/web runs its own Vite server and proxies /api and /ws
  // here instead, so this is a no-op until `npm run build -w apps/web` runs.
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const webDist = path.resolve(__dirname, "../../web/dist");
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    // The SPA has client-side "routes" outside App.tsx's in-memory view-switching:
    // a freshly loaded (not client-navigated) `/invite/:token` or `/project/:id`
    // link, e.g. pasted into a browser or opened from a bookmark. @fastify/static
    // only serves the file matching the request path, so those paths 404 without
    // this explicit fallback to index.html (Vite's dev server already does this
    // by default, so dev needs no equivalent).
    app.get("/invite/:token", (_req, reply) => reply.sendFile("index.html"));
    app.get("/project/:id", (_req, reply) => reply.sendFile("index.html"));
    app.log.info(`serving built web app from ${webDist}`);
  }

  app.register(async (instance) => {
    instance.get(
      "/ws/:projectId",
      {
        websocket: true,
        // Runs before the HTTP upgrade completes, so a rejection here sends a
        // plain 401/404 instead of the connection ever becoming a WebSocket —
        // stricter and simpler than closing the socket post-upgrade.
        preHandler: async (req) => {
          if (!req.user) throw new ApiError("AUTH_REQUIRED");
          const { projectId } = req.params as { projectId: string };
          // Every REST route checks the project exists before touching its room —
          // this was the one path that didn't. Skipping it let anyone crash the
          // whole process with a single connect+disconnect to a made-up id: the
          // room got created regardless, and `Room.leave()`'s snapshot insert
          // against a nonexistent `project_id` throws a foreign-key error that
          // was never caught, taking the entire server down for every project.
          if (!getProjectRow(projectId)) throw new ApiError("PROJECT_NOT_FOUND");
          if (!getEffectivePermission(req.user.id, projectId)) throw new ApiError("FORBIDDEN");
        },
      },
      (socket: WebSocket, req) => {
        const { projectId } = req.params as { projectId: string };
        const author = req.user!.displayName;
        const userId = req.user!.id;
        const room = getRoom(projectId);

        // Resolved on every use rather than captured once — see `Room.join`.
        // `null` (no permission at all) closes the socket instead of silently
        // downgrading it to read-only, which is what a user removed from a
        // project should experience.
        room.join(socket, author, () => {
          const level = getEffectivePermission(userId, projectId);
          return level ? { canWrite: level !== "view" } : null;
        });
        // `req.log` rather than `app.log`: this is the one point in a
        // connection's life that maps to a single request (the WS upgrade),
        // so it's the one place a `reqId` can actually correlate — unlike
        // `Room`'s own logs, which span every connection over its lifetime
        // (see `realtime/room/logger.ts`).
        req.log.info({ room: projectId, author }, "joined project");

        socket.on("message", (data: Buffer) => {
          room.receive(socket, new Uint8Array(data));
        });

        socket.on("close", () => {
          room.leave(socket);
          req.log.info({ room: projectId, author }, "left project");
        });
      },
    );
  });

  return app;
}
