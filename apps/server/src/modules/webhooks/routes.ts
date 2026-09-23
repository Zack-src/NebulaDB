import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { auditUser } from "../../shared/audit.js";
import { encryptPayload } from "../../shared/crypto.js";
import { ApiError } from "../../shared/errors.js";
import { requireProjectAdmin } from "../../shared/guards.js";
import { assertHostAllowed } from "../connections/hostGuard.js";
import { invalidateWebhookCache, sendPing } from "./dispatcher.js";
import {
  SUBSCRIBABLE_EVENTS,
  WEBHOOK_FORMATS,
  countWebhooks,
  deleteWebhook,
  getWebhook,
  insertWebhook,
  listRecentDeliveries,
  listWebhooks,
  toWebhook,
  updateWebhook,
  type DeliveryRow,
  type WebhookEvent,
  type WebhookFormat,
} from "./repository.js";

/**
 * Project-administrator only, same bar as database connections: a webhook
 * makes the server send requests to an address of the caller's choosing, and
 * pushes the project's name and change summaries out of the instance.
 */

const MAX_WEBHOOKS_PER_PROJECT = 10;
const MAX_URL_LENGTH = 2000;
/** The "send a test" button hits an arbitrary URL on demand — keep a script from turning it into a request cannon. */
const TEST_RATE_LIMIT = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

async function parseUrl(raw: unknown): Promise<string> {
  if (typeof raw !== "string" || raw.length > MAX_URL_LENGTH) throw new ApiError("WEBHOOK_URL_INVALID");
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ApiError("WEBHOOK_URL_INVALID");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ApiError("WEBHOOK_URL_INVALID");
  if (url.username || url.password) {
    // Credentials in the URL would be shown back to every project admin in the list.
    throw new ApiError("WEBHOOK_URL_INVALID", { message: "put credentials in the receiving service, not in the URL" });
  }
  // Early, friendly refusal; the real enforcement is the connect-time check in `delivery.ts`.
  await assertHostAllowed(url.hostname);
  return url.toString();
}

function parseFormat(raw: unknown): WebhookFormat {
  if (raw === undefined) return "json";
  if (typeof raw !== "string" || !(WEBHOOK_FORMATS as string[]).includes(raw))
    throw new ApiError("WEBHOOK_FORMAT_INVALID");
  return raw as WebhookFormat;
}

function parseEvents(raw: unknown): WebhookEvent[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new ApiError("WEBHOOK_EVENTS_INVALID");
  const unique = [...new Set(raw)];
  if (!unique.every((e) => typeof e === "string" && (SUBSCRIBABLE_EVENTS as string[]).includes(e))) {
    throw new ApiError("WEBHOOK_EVENTS_INVALID");
  }
  return unique as WebhookEvent[];
}

function toDeliverySummary(row: DeliveryRow) {
  return {
    id: row.id,
    event: row.event,
    status: row.status,
    attempts: row.attempts,
    responseStatus: row.response_status,
    error: row.last_error,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function registerWebhookRoutes(app: FastifyInstance): void {
  app.get("/api/projects/:id/webhooks", async (req) => {
    const { id } = req.params as { id: string };
    requireProjectAdmin(req, id);
    return listWebhooks(id).map(toWebhook);
  });

  /** The signing secret is returned here once and never again — store it in the receiving service now. */
  app.post("/api/projects/:id/webhooks", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { user } = requireProjectAdmin(req, id);
    const body = (req.body ?? {}) as { url?: unknown; format?: unknown; events?: unknown };
    const url = await parseUrl(body.url);
    const format = parseFormat(body.format);
    const events = parseEvents(body.events ?? SUBSCRIBABLE_EVENTS);
    if (countWebhooks(id) >= MAX_WEBHOOKS_PER_PROJECT) throw new ApiError("WEBHOOK_LIMIT_REACHED");

    const secret = `whsec_${crypto.randomBytes(32).toString("base64url")}`;
    const webhookId = crypto.randomUUID();
    insertWebhook({
      id: webhookId,
      projectId: id,
      url,
      format,
      events,
      secretEncrypted: encryptPayload(secret),
      createdBy: user.id,
    });
    invalidateWebhookCache(id);
    auditUser(user, "webhook.create", { type: "project", id }, `${format} → ${new URL(url).host}`, req);
    return reply.code(201).send({ webhook: toWebhook(getWebhook(id, webhookId)!), secret });
  });

  app.patch("/api/projects/:id/webhooks/:hookId", async (req) => {
    const { id, hookId } = req.params as { id: string; hookId: string };
    const { user } = requireProjectAdmin(req, id);
    if (!getWebhook(id, hookId)) throw new ApiError("WEBHOOK_NOT_FOUND");
    const body = (req.body ?? {}) as { url?: unknown; format?: unknown; events?: unknown; enabled?: unknown };
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") throw new ApiError("WEBHOOK_ENABLED_INVALID");
    updateWebhook(hookId, {
      url: body.url !== undefined ? await parseUrl(body.url) : undefined,
      format: body.format !== undefined ? parseFormat(body.format) : undefined,
      events: body.events !== undefined ? parseEvents(body.events) : undefined,
      enabled: body.enabled as boolean | undefined,
    });
    auditUser(user, "webhook.update", { type: "project", id }, hookId, req);
    return toWebhook(getWebhook(id, hookId)!);
  });

  app.delete("/api/projects/:id/webhooks/:hookId", async (req) => {
    const { id, hookId } = req.params as { id: string; hookId: string };
    const { user } = requireProjectAdmin(req, id);
    if (!getWebhook(id, hookId)) throw new ApiError("WEBHOOK_NOT_FOUND");
    deleteWebhook(hookId);
    invalidateWebhookCache(id);
    auditUser(user, "webhook.delete", { type: "project", id }, hookId, req);
    return { deleted: true };
  });

  app.post("/api/projects/:id/webhooks/:hookId/test", TEST_RATE_LIMIT, async (req) => {
    const { id, hookId } = req.params as { id: string; hookId: string };
    requireProjectAdmin(req, id);
    const webhook = getWebhook(id, hookId);
    if (!webhook) throw new ApiError("WEBHOOK_NOT_FOUND");
    return toDeliverySummary(await sendPing(webhook));
  });

  app.get("/api/projects/:id/webhooks/:hookId/deliveries", async (req) => {
    const { id, hookId } = req.params as { id: string; hookId: string };
    requireProjectAdmin(req, id);
    if (!getWebhook(id, hookId)) throw new ApiError("WEBHOOK_NOT_FOUND");
    return listRecentDeliveries(hookId).map(toDeliverySummary);
  });
}
