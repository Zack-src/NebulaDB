import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { purgeExpiredSessions, resolveSession } from "./auth/session.js";
import { config } from "./config.js";
import { db } from "./db.js";
import { getEffectivePermission } from "./permissions.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerInvitationRoutes } from "./routes/invitations.js";
import { getProjectRow, registerProjectRoutes } from "./routes/projects.js";
import { registerTeamRoutes } from "./routes/teams.js";
import { registerConvertRoutes } from "./routes/convert.js";
import { registerUserRoutes } from "./routes/users.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { purgeStaleAttempts } from "./auth/lockout.js";
import { purgeOldAuditEntries } from "./audit.js";
import { backupTimestamp, pruneOldBackups, runBackup } from "./backupRunner.js";
import { closeAllRooms, flushAllRooms, getRoom, liveRoomCount } from "./yjs/room.js";

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
app.addHook("onRequest", async (req, reply) => {
  if (SAFE_METHODS.has(req.method)) return;
  const origin = req.headers.origin;
  if (!origin || origin === "null") return;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    reply.code(403).send({ error: "invalid origin" });
    return reply;
  }
  if (originHost === req.headers.host) return;
  if (config.allowedOrigins.includes(origin.replace(/\/$/, ""))) return;

  req.log.warn({ origin, host: req.headers.host }, "rejected cross-origin state-changing request");
  reply.code(403).send({ error: "cross-origin request refused" });
  return reply;
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
    return { status: "error", error: "database unavailable" };
  }
});
registerAuthRoutes(app);
registerInvitationRoutes(app);
registerUserRoutes(app);
registerTeamRoutes(app);
registerProjectRoutes(app);
registerConvertRoutes(app);
registerAuditRoutes(app);

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
      preHandler: async (req, reply) => {
        if (!req.user) {
          reply.code(401).send({ error: "authentication required" });
          return;
        }
        const { projectId } = req.params as { projectId: string };
        // Every REST route checks the project exists before touching its room —
        // this was the one path that didn't. Skipping it let anyone crash the
        // whole process with a single connect+disconnect to a made-up id: the
        // room got created regardless, and `Room.leave()`'s snapshot insert
        // against a nonexistent `project_id` throws a foreign-key error that
        // was never caught, taking the entire server down for every project.
        if (!getProjectRow(projectId)) {
          reply.code(404).send({ error: "project not found" });
          return;
        }
        if (!getEffectivePermission(req.user.id, projectId)) {
          reply.code(403).send({ error: "forbidden" });
          return;
        }
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
      app.log.info(`${author} joined project ${projectId}`);

      socket.on("message", (data: Buffer) => {
        room.receive(socket, new Uint8Array(data));
      });

      socket.on("close", () => {
        room.leave(socket);
        app.log.info(`${author} left project ${projectId}`);
      });
    },
  );
});

// Expired rows were never removed, so `sessions` grew forever. Sweep at boot
// and hourly; `unref` so this timer alone can't hold the process open.
const SESSION_SWEEP_MS = 60 * 60 * 1000;
const sweepSessions = () => {
  try {
    const removed = purgeExpiredSessions();
    if (removed > 0) app.log.info(`purged ${removed} expired session(s)`);
    // Same schedule, same rationale: failed-login counters for accounts that
    // are no longer locked and haven't failed in a day carry no information.
    const attempts = purgeStaleAttempts();
    if (attempts > 0) app.log.info(`purged ${attempts} stale login attempt row(s)`);
    // Same schedule again: the audit trail is the one table with no natural
    // ceiling, so its retention has to be enforced somewhere rather than left
    // as a sentence in a policy document.
    const audits = purgeOldAuditEntries(config.auditRetentionDays);
    if (audits > 0) app.log.info(`purged ${audits} audit entry(ies) past the ${config.auditRetentionDays}-day retention`);
  } catch (err) {
    app.log.error({ err }, "session sweep failed");
  }
};
sweepSessions();
const sessionSweepTimer = setInterval(sweepSessions, SESSION_SWEEP_MS);
sessionSweepTimer.unref();

/**
 * Scheduled backups, off unless `ATHANORDB_BACKUP_INTERVAL_HOURS` is set.
 *
 * `backup.ts` has always worked, but nothing in a running deployment ever
 * called it — a backup that depends on someone remembering the command is a
 * backup most instances don't actually have. Old directories are pruned so
 * this doesn't slowly fill the volume the database itself lives on.
 *
 * Deliberately not run at boot: a restart loop would otherwise produce a
 * backup per crash and prune away the older, *good* ones.
 */
let backupTimer: NodeJS.Timeout | null = null;
if (config.backupIntervalHours > 0) {
  const runScheduledBackup = () => {
    try {
      const result = runBackup(path.join(config.backupDir, backupTimestamp()));
      const pruned = pruneOldBackups(config.backupDir, config.backupKeep);
      app.log.info(
        `backup: ${result.backedUp} project(s) written to ${result.dir}` +
          `${result.skipped > 0 ? `, ${result.skipped} skipped` : ""}` +
          `${pruned > 0 ? `, ${pruned} old backup(s) pruned` : ""}`,
      );
    } catch (err) {
      // A failed backup must never take the server down with it.
      app.log.error({ err }, "scheduled backup failed");
    }
  };
  backupTimer = setInterval(runScheduledBackup, config.backupIntervalHours * 60 * 60 * 1000);
  backupTimer.unref();
  app.log.info(
    `scheduled backups every ${config.backupIntervalHours}h into ${path.resolve(config.backupDir)} (keeping ${config.backupKeep})`,
  );
}

/**
 * `docker stop` / `docker compose down` send SIGTERM with nothing listening,
 * which dropped in-flight WebSocket connections and any pending debounced
 * snapshot (up to ~2s of edits). Stop accepting new work, flush every live
 * room to SQLite, then close the database.
 */
const SHUTDOWN_TIMEOUT_MS = 10_000;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info(`${signal} received — shutting down`);

  // Hard ceiling: a stuck close must not leave the container hanging until the
  // orchestrator SIGKILLs it, which is exactly the unflushed-state case above.
  const timer = setTimeout(() => {
    app.log.error("shutdown timed out — forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  timer.unref();

  clearInterval(sessionSweepTimer);
  if (backupTimer) clearInterval(backupTimer);
  try {
    const flushed = flushAllRooms();
    if (flushed > 0) app.log.info(`flushed ${flushed} room snapshot(s)`);
    closeAllRooms();
    await app.close();
    db.close();
    app.log.info("shutdown complete");
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "error during shutdown");
    process.exit(1);
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => void shutdown(signal));
}

/**
 * Last-resort guards. Without them a single uncaught throw anywhere (a WS
 * `message`/`close` handler, a stray promise) takes the whole process down —
 * and with it every other project's live session, not just the one that
 * failed. State is snapshotted immediately so nothing is lost if the process
 * does go on to die, but the process is deliberately kept alive: for a
 * collaborative server, dropping everyone is strictly worse than continuing in
 * a possibly-degraded state, and every known failure path here is already
 * isolated per-connection.
 */
process.on("uncaughtException", (err) => {
  app.log.error({ err }, "uncaught exception — server kept alive, state flushed");
  try {
    flushAllRooms();
  } catch (flushErr) {
    app.log.error({ err: flushErr }, "flush after uncaught exception failed");
  }
});

process.on("unhandledRejection", (reason) => {
  app.log.error({ err: reason }, "unhandled promise rejection");
});

app.listen({ port: config.port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
