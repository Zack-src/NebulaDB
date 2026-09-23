import { db } from "../../infrastructure/db.js";

export type WebhookEvent = "schema.changed" | "deployment.completed" | "ping";
/** Events a webhook can subscribe to — `ping` is only ever sent on demand (the "send a test" button). */
export const SUBSCRIBABLE_EVENTS: WebhookEvent[] = ["schema.changed", "deployment.completed"];
export type WebhookFormat = "json" | "slack" | "discord";
export const WEBHOOK_FORMATS: WebhookFormat[] = ["json", "slack", "discord"];

export interface WebhookRow {
  id: string;
  project_id: string;
  url: string;
  format: WebhookFormat;
  events: string;
  secret_encrypted: string;
  enabled: number;
  consecutive_failures: number;
  disabled_reason: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Webhook {
  id: string;
  projectId: string;
  url: string;
  format: WebhookFormat;
  events: WebhookEvent[];
  enabled: boolean;
  consecutiveFailures: number;
  disabledReason: string | null;
  createdAt: string;
}

export function toWebhook(row: WebhookRow): Webhook {
  return {
    id: row.id,
    projectId: row.project_id,
    url: row.url,
    format: row.format,
    events: JSON.parse(row.events) as WebhookEvent[],
    enabled: row.enabled === 1,
    consecutiveFailures: row.consecutive_failures,
    disabledReason: row.disabled_reason,
    createdAt: row.created_at,
  };
}

const COLUMNS =
  "id, project_id, url, format, events, secret_encrypted, enabled, consecutive_failures, disabled_reason, created_by, created_at";

export function listWebhooks(projectId: string): WebhookRow[] {
  return db
    .prepare(`SELECT ${COLUMNS} FROM project_webhooks WHERE project_id = ? ORDER BY created_at`)
    .all(projectId) as WebhookRow[];
}

export function getWebhook(projectId: string, id: string): WebhookRow | undefined {
  return db.prepare(`SELECT ${COLUMNS} FROM project_webhooks WHERE id = ? AND project_id = ?`).get(id, projectId) as
    WebhookRow | undefined;
}

export function getWebhookById(id: string): WebhookRow | undefined {
  return db.prepare(`SELECT ${COLUMNS} FROM project_webhooks WHERE id = ?`).get(id) as WebhookRow | undefined;
}

/** Enabled webhooks of `projectId` subscribed to `event` (every enabled one for `ping`'s caller, which picks its own). */
export function listSubscribers(projectId: string, event: WebhookEvent): WebhookRow[] {
  return listWebhooks(projectId).filter(
    (row) => row.enabled === 1 && (JSON.parse(row.events) as WebhookEvent[]).includes(event),
  );
}

export function countWebhooks(projectId: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM project_webhooks WHERE project_id = ?").get(projectId) as { n: number })
    .n;
}

export function insertWebhook(row: {
  id: string;
  projectId: string;
  url: string;
  format: WebhookFormat;
  events: WebhookEvent[];
  secretEncrypted: string;
  createdBy: string;
}): void {
  db.prepare(
    `INSERT INTO project_webhooks (id, project_id, url, format, events, secret_encrypted, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.projectId,
    row.url,
    row.format,
    JSON.stringify(row.events),
    row.secretEncrypted,
    row.createdBy,
    new Date().toISOString(),
  );
}

export function updateWebhook(
  id: string,
  changes: { url?: string; format?: WebhookFormat; events?: WebhookEvent[]; enabled?: boolean },
): void {
  if (changes.url !== undefined) db.prepare("UPDATE project_webhooks SET url = ? WHERE id = ?").run(changes.url, id);
  if (changes.format !== undefined)
    db.prepare("UPDATE project_webhooks SET format = ? WHERE id = ?").run(changes.format, id);
  if (changes.events !== undefined)
    db.prepare("UPDATE project_webhooks SET events = ? WHERE id = ?").run(JSON.stringify(changes.events), id);
  if (changes.enabled !== undefined) {
    // Re-enabling by hand is the operator saying "the endpoint is fixed": start the failure count over.
    db.prepare(
      "UPDATE project_webhooks SET enabled = ?, consecutive_failures = CASE WHEN ? = 1 THEN 0 ELSE consecutive_failures END, disabled_reason = CASE WHEN ? = 1 THEN NULL ELSE disabled_reason END WHERE id = ?",
    ).run(changes.enabled ? 1 : 0, changes.enabled ? 1 : 0, changes.enabled ? 1 : 0, id);
  }
}

export function deleteWebhook(id: string): void {
  db.transaction(() => {
    db.prepare("DELETE FROM webhook_deliveries WHERE webhook_id = ?").run(id);
    db.prepare("DELETE FROM project_webhooks WHERE id = ?").run(id);
  })();
}

// --- deliveries ---

export type DeliveryStatus = "pending" | "succeeded" | "failed";

export interface DeliveryRow {
  id: string;
  webhook_id: string;
  event: WebhookEvent;
  payload: string;
  status: DeliveryStatus;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  response_status: number | null;
  created_at: string;
  completed_at: string | null;
}

export function insertDelivery(row: { id: string; webhookId: string; event: WebhookEvent; payload: string }): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO webhook_deliveries (id, webhook_id, event, payload, status, attempts, next_attempt_at, created_at)
     VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)`,
  ).run(row.id, row.webhookId, row.event, row.payload, now, now);
}

export function listDueDeliveries(now: string, limit: number): DeliveryRow[] {
  return db
    .prepare(
      `SELECT * FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?`,
    )
    .all(now, limit) as DeliveryRow[];
}

export function getDelivery(id: string): DeliveryRow | undefined {
  return db.prepare("SELECT * FROM webhook_deliveries WHERE id = ?").get(id) as DeliveryRow | undefined;
}

export function listRecentDeliveries(webhookId: string, limit = 20): DeliveryRow[] {
  return db
    .prepare("SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(webhookId, limit) as DeliveryRow[];
}

export function recordAttempt(
  id: string,
  outcome: {
    status: DeliveryStatus;
    attempts: number;
    nextAttemptAt: string | null;
    error: string | null;
    responseStatus: number | null;
  },
): void {
  db.prepare(
    `UPDATE webhook_deliveries SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ?, response_status = ?,
       completed_at = CASE WHEN ? = 'pending' THEN NULL ELSE ? END
     WHERE id = ?`,
  ).run(
    outcome.status,
    outcome.attempts,
    outcome.nextAttemptAt,
    outcome.error,
    outcome.responseStatus,
    outcome.status,
    new Date().toISOString(),
    id,
  );
}

/** Returns the webhook's new consecutive-failure count after a delivery gave up (or 0 after a success). */
export function recordWebhookOutcome(webhookId: string, succeeded: boolean): number {
  if (succeeded) {
    db.prepare("UPDATE project_webhooks SET consecutive_failures = 0 WHERE id = ?").run(webhookId);
    return 0;
  }
  db.prepare("UPDATE project_webhooks SET consecutive_failures = consecutive_failures + 1 WHERE id = ?").run(webhookId);
  return (
    (
      db.prepare("SELECT consecutive_failures AS n FROM project_webhooks WHERE id = ?").get(webhookId) as
        { n: number } | undefined
    )?.n ?? 0
  );
}

export function disableWebhook(webhookId: string, reason: string): void {
  db.prepare("UPDATE project_webhooks SET enabled = 0, disabled_reason = ? WHERE id = ?").run(reason, webhookId);
}

/** Deliveries are a log, not an archive — kept for 30 days. */
export function purgeOldDeliveries(retentionDays = 30): number {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare("DELETE FROM webhook_deliveries WHERE status != 'pending' AND created_at < ?").run(cutoff).changes;
}
