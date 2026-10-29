import crypto from "node:crypto";
import type { FastifyRequest } from "fastify";
import { auditUser } from "../../shared/audit.js";
import { encryptPayload } from "../../shared/crypto.js";
import { ApiError } from "../../shared/errors.js";
import { invalidateWebhookCache, sendPing } from "./dispatcher.js";
import { assertWebhookTargetAllowed } from "./targetPolicy.js";
import {
  SUBSCRIBABLE_EVENTS,
  WEBHOOK_FORMATS,
  countWebhooks,
  deleteWebhook,
  getWebhook,
  insertWebhook,
  listRecentDeliveries,
  listWebhooks,
  setWebhookSecret,
  toWebhook,
  updateWebhook,
  type DeliveryRow,
  type Webhook,
  type WebhookEvent,
  type WebhookFormat,
  type WebhookRow,
} from "./repository.js";

/**
 * What can be done with a project's webhooks, once — the app's routes and
 * `/api/v1` both come here, so the two cannot disagree on a rule. Who may do
 * it (project administrators) is the routes' to check.
 */

type Actor = { id: string; email: string };

const MAX_WEBHOOKS_PER_PROJECT = 10;
const MAX_URL_LENGTH = 2000;

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
  await assertWebhookTargetAllowed(url.hostname);
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

async function requireWebhook(projectId: string, hookId: string): Promise<WebhookRow> {
  const webhook = await getWebhook(projectId, hookId);
  if (!webhook) throw new ApiError("WEBHOOK_NOT_FOUND");
  return webhook;
}

const newSecret = () => `whsec_${crypto.randomBytes(32).toString("base64url")}`;

export async function projectWebhooks(projectId: string): Promise<Webhook[]> {
  return (await listWebhooks(projectId)).map(toWebhook);
}

/** The signing secret is returned here once and never again — store it in the receiving service now. */
export async function createWebhookFor(
  user: Actor,
  projectId: string,
  rawBody: unknown,
  req: FastifyRequest,
): Promise<{ webhook: Webhook; secret: string }> {
  const body = (rawBody ?? {}) as { url?: unknown; format?: unknown; events?: unknown };
  const url = await parseUrl(body.url);
  const format = parseFormat(body.format);
  const events = parseEvents(body.events ?? SUBSCRIBABLE_EVENTS);
  if ((await countWebhooks(projectId)) >= MAX_WEBHOOKS_PER_PROJECT) throw new ApiError("WEBHOOK_LIMIT_REACHED");

  const secret = newSecret();
  const webhookId = crypto.randomUUID();
  await insertWebhook({
    id: webhookId,
    projectId,
    url,
    format,
    events,
    secretEncrypted: encryptPayload(secret),
    createdBy: user.id,
  });
  await invalidateWebhookCache(projectId);
  await auditUser(user, "webhook.create", { type: "project", id: projectId }, `${format} → ${new URL(url).host}`, req);
  return { webhook: toWebhook((await getWebhook(projectId, webhookId))!), secret };
}

export async function changeWebhook(
  user: Actor,
  projectId: string,
  hookId: string,
  rawBody: unknown,
  req: FastifyRequest,
): Promise<Webhook> {
  await requireWebhook(projectId, hookId);
  const body = (rawBody ?? {}) as { url?: unknown; format?: unknown; events?: unknown; enabled?: unknown };
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") throw new ApiError("WEBHOOK_ENABLED_INVALID");
  await updateWebhook(hookId, {
    url: body.url !== undefined ? await parseUrl(body.url) : undefined,
    format: body.format !== undefined ? parseFormat(body.format) : undefined,
    events: body.events !== undefined ? parseEvents(body.events) : undefined,
    enabled: body.enabled as boolean | undefined,
  });
  await auditUser(user, "webhook.update", { type: "project", id: projectId }, hookId, req);
  return toWebhook((await getWebhook(projectId, hookId))!);
}

export async function removeWebhook(
  user: Actor,
  projectId: string,
  hookId: string,
  req: FastifyRequest,
): Promise<void> {
  await requireWebhook(projectId, hookId);
  await deleteWebhook(hookId);
  await invalidateWebhookCache(projectId);
  await auditUser(user, "webhook.delete", { type: "project", id: projectId }, hookId, req);
}

/**
 * A new signing secret for the same webhook — its address, events and history
 * stay. The old secret stops signing at once: a delivery still waiting for a
 * retry is signed with the new one when it goes out. Shown once, like the first.
 */
export async function rotateWebhookSecret(
  user: Actor,
  projectId: string,
  hookId: string,
  req: FastifyRequest,
): Promise<{ webhook: Webhook; secret: string }> {
  await requireWebhook(projectId, hookId);
  const secret = newSecret();
  await setWebhookSecret(hookId, encryptPayload(secret));
  await auditUser(user, "webhook.rotate_secret", { type: "project", id: projectId }, hookId, req);
  return { webhook: toWebhook((await getWebhook(projectId, hookId))!), secret };
}

export async function pingWebhook(projectId: string, hookId: string) {
  return toDeliverySummary(await sendPing(await requireWebhook(projectId, hookId)));
}

export async function webhookDeliveries(projectId: string, hookId: string) {
  await requireWebhook(projectId, hookId);
  return (await listRecentDeliveries(hookId)).map(toDeliverySummary);
}
