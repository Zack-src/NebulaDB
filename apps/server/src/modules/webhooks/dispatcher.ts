import { diffProjects } from "@athanordb/dbml-engine";
import type { Project } from "@athanordb/shared";
import { config } from "../../config.js";
import { db } from "../../infrastructure/db.js";
import { readProjectReadOnly, readSnapshotProject } from "../../realtime/readOnlyProject.js";
import { decryptPayload } from "../../shared/crypto.js";
import { deliver, renderBody, signBody, type WebhookEnvelope } from "./delivery.js";
import {
  countWebhooks,
  disableWebhook,
  getDelivery,
  getWebhookById,
  insertDelivery,
  listDueDeliveries,
  listSubscribers,
  recordAttempt,
  recordWebhookOutcome,
  type DeliveryRow,
  type WebhookEvent,
  type WebhookRow,
} from "./repository.js";

/**
 * Turns app events into queued deliveries and works the queue.
 *
 * Every delivery is a row first (`webhook_deliveries`), sent second — so a
 * crash or restart between the event and the HTTP call loses nothing, and
 * retries are just rows whose `next_attempt_at` is in the future.
 */

/** Waits before attempts 2..6 — about 9 hours end to end before a delivery is abandoned. */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000];
/** After this many abandoned deliveries in a row, the webhook is switched off rather than retried forever. */
export const AUTO_DISABLE_AFTER = 20;
const BATCH = 20;

function projectInfo(projectId: string): { id: string; name: string; url: string | null } | null {
  const row = db.prepare("SELECT name FROM projects WHERE id = ?").get(projectId) as { name: string } | undefined;
  if (!row) return null;
  return { id: projectId, name: row.name, url: config.publicUrl ? `${config.publicUrl}/project/${projectId}` : null };
}

function enqueue(
  webhook: WebhookRow,
  event: WebhookEvent,
  project: WebhookEnvelope["project"],
  data: Record<string, unknown>,
) {
  const id = crypto.randomUUID();
  const envelope: WebhookEnvelope = { id, event, occurredAt: new Date().toISOString(), project, data };
  insertDelivery({ id, webhookId: webhook.id, event, payload: JSON.stringify(envelope) });
  return id;
}

/** Queues `event` for every enabled webhook of the project subscribed to it, then nudges the worker. */
export function emitWebhookEvent(
  projectId: string,
  event: Exclude<WebhookEvent, "ping">,
  data: Record<string, unknown>,
): void {
  const subscribers = listSubscribers(projectId, event);
  if (subscribers.length === 0) return;
  const project = projectInfo(projectId);
  if (!project) return;
  for (const webhook of subscribers) enqueue(webhook, event, project, data);
  kick();
}

/** The "send a test" button: queues a `ping` for one webhook and delivers it right away, returning the outcome. */
export async function sendPing(webhook: WebhookRow): Promise<DeliveryRow> {
  const project = projectInfo(webhook.project_id)!;
  const id = enqueue(webhook, "ping", project, { message: "Test depuis AthanorDB" });
  await attempt(getDelivery(id)!);
  return getDelivery(id)!;
}

async function attempt(delivery: DeliveryRow): Promise<void> {
  const webhook = getWebhookById(delivery.webhook_id);
  const attempts = delivery.attempts + 1;
  if (!webhook || (webhook.enabled !== 1 && delivery.event !== "ping")) {
    recordAttempt(delivery.id, {
      status: "failed",
      attempts: delivery.attempts,
      nextAttemptAt: null,
      error: "webhook disabled or deleted",
      responseStatus: null,
    });
    return;
  }

  const envelope = JSON.parse(delivery.payload) as WebhookEnvelope;
  const body = renderBody(envelope, webhook.format);
  let secret: string;
  try {
    secret = decryptPayload<string>(webhook.secret_encrypted);
  } catch {
    recordAttempt(delivery.id, {
      status: "failed",
      attempts,
      nextAttemptAt: null,
      error: "signing secret unreadable (was ATHANORDB_SECRET changed?)",
      responseStatus: null,
    });
    return;
  }
  const result = await deliver(webhook.url, body, {
    "x-athanordb-event": envelope.event,
    "x-athanordb-delivery": envelope.id,
    "x-athanordb-signature": signBody(secret, body, Math.floor(Date.now() / 1000)),
  });

  if (result.ok) {
    recordAttempt(delivery.id, {
      status: "succeeded",
      attempts,
      nextAttemptAt: null,
      error: null,
      responseStatus: result.status,
    });
    recordWebhookOutcome(webhook.id, true);
    return;
  }

  const delay = delivery.event === "ping" ? undefined : RETRY_DELAYS_MS[attempts - 1];
  if (delay !== undefined) {
    recordAttempt(delivery.id, {
      status: "pending",
      attempts,
      nextAttemptAt: new Date(Date.now() + delay).toISOString(),
      error: result.error,
      responseStatus: result.status,
    });
    return;
  }
  recordAttempt(delivery.id, {
    status: "failed",
    attempts,
    nextAttemptAt: null,
    error: result.error,
    responseStatus: result.status,
  });
  // A failed ping is feedback for the person testing, not a sign the endpoint is dead.
  if (delivery.event === "ping") return;
  const failures = recordWebhookOutcome(webhook.id, false);
  if (failures >= AUTO_DISABLE_AFTER) {
    disableWebhook(webhook.id, `désactivé automatiquement après ${failures} livraisons échouées d'affilée`);
  }
}

let running: Promise<void> | null = null;

async function drainDueDeliveries(): Promise<void> {
  for (;;) {
    const due = listDueDeliveries(new Date().toISOString(), BATCH);
    if (due.length === 0) return;
    for (const delivery of due) await attempt(delivery);
  }
}

/** Works through every due delivery. Never runs twice at once — a second call waits for the first. */
export function processDueDeliveries(): Promise<void> {
  if (running) return running;
  // Cleared from `.finally` on purpose, not from a `finally` block inside the
  // async function: with nothing due, that function completes synchronously,
  // so its `finally` would run *before* this assignment and leave `running`
  // pinned to a settled promise — silently stopping the queue for good.
  running = drainDueDeliveries().finally(() => {
    running = null;
  });
  return running;
}

function kick(): void {
  setImmediate(() => {
    processDueDeliveries().catch(() => {});
  });
}

let workerTimer: NodeJS.Timeout | null = null;

/** Picks up retries whose time has come. Started from `index.ts`, not `buildApp`, so tests drive it explicitly. */
export function startWebhookWorker(intervalMs = 15_000): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => void processDueDeliveries().catch(() => {}), intervalMs);
  workerTimer.unref();
}

// --- schema.changed: coalesced ---

/**
 * A burst of edits (typing a column name fires one update per keystroke)
 * becomes one `schema.changed` once the project has been quiet for this
 * long, listing everyone who edited in between.
 */
let quietPeriodMs = 30_000;
const pending = new Map<string, { timer: NodeJS.Timeout; authors: Set<string> }>();
/**
 * What each project looked like at its last notification — lets the next one
 * say what changed. In memory; after a restart, the first edit seeds it from
 * the stored snapshot, which still predates that edit (snapshots are
 * debounced), so even the first notification can tell a real schema change
 * from a table being dragged around.
 */
const lastNotified = new Map<string, Project>();

export function setSchemaChangeQuietPeriod(ms: number): void {
  quietPeriodMs = ms;
}

/**
 * Whether a project has any webhook at all, cached: `noteSchemaChange` runs
 * on every doc update of every project, and almost none have webhooks — that
 * path must cost a Map lookup, not a query. The routes invalidate on
 * create/delete.
 */
const hasWebhooksCache = new Map<string, boolean>();

export function invalidateWebhookCache(projectId: string): void {
  hasWebhooksCache.delete(projectId);
  if (countWebhooks(projectId) === 0) {
    lastNotified.delete(projectId);
    const entry = pending.get(projectId);
    if (entry) clearTimeout(entry.timer);
    pending.delete(projectId);
  }
}

function projectHasWebhooks(projectId: string): boolean {
  let has = hasWebhooksCache.get(projectId);
  if (has === undefined) {
    has = countWebhooks(projectId) > 0;
    hasWebhooksCache.set(projectId, has);
  }
  return has;
}

/** Called for every doc update (see `setRoomDocChangeListener`); a Map lookup unless the project has webhooks. */
export function noteSchemaChange(projectId: string, author: string): void {
  if (!projectHasWebhooks(projectId)) return;
  if (!lastNotified.has(projectId)) {
    const name = projectInfo(projectId)?.name ?? "";
    lastNotified.set(projectId, readSnapshotProject(projectId, name));
  }
  const entry = pending.get(projectId) ?? { timer: undefined as unknown as NodeJS.Timeout, authors: new Set<string>() };
  clearTimeout(entry.timer);
  if (author && author !== "system") entry.authors.add(author);
  entry.timer = setTimeout(() => flushSchemaChange(projectId), quietPeriodMs);
  entry.timer.unref();
  pending.set(projectId, entry);
}

export function flushSchemaChange(projectId: string): void {
  const entry = pending.get(projectId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(projectId);
  if (listSubscribers(projectId, "schema.changed").length === 0) return;
  const project = projectInfo(projectId);
  if (!project) return;

  const current = readProjectReadOnly(projectId, project.name);
  const baseline = lastNotified.get(projectId);
  lastNotified.set(projectId, current);
  let changes: Record<string, number> | null = null;
  if (baseline) {
    const diff = diffProjects(baseline, current);
    changes = {
      tablesAdded: diff.tables.filter((t) => t.status === "added").length,
      tablesRemoved: diff.tables.filter((t) => t.status === "removed").length,
      tablesChanged: diff.tables.filter((t) => t.status === "changed").length,
      refsChanged: diff.refs.length,
    };
    // Nothing structural moved (a table dragged, a colour changed): not worth a notification.
    if (Object.values(changes).every((n) => n === 0)) return;
  }
  emitWebhookEvent(projectId, "schema.changed", {
    authors: [...entry.authors],
    changes,
    tableCount: current.tables.length,
  });
}

/** Tests only. */
export function resetWebhookState(): void {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
  lastNotified.clear();
  hasWebhooksCache.clear();
}
