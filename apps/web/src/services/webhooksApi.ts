import { request } from "./httpClient";

export type WebhookEvent = "schema.changed" | "deployment.completed";
export type WebhookFormat = "json" | "slack" | "discord";

export interface Webhook {
  id: string;
  projectId: string;
  url: string;
  format: WebhookFormat;
  events: WebhookEvent[];
  enabled: boolean;
  consecutiveFailures: number;
  /** Set when the server switched it off after repeated failures. */
  disabledReason: string | null;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  event: WebhookEvent | "ping";
  status: "pending" | "succeeded" | "failed";
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  completedAt: string | null;
}

const base = (projectId: string) => `/api/projects/${projectId}/webhooks`;

export function fetchWebhooks(projectId: string): Promise<Webhook[]> {
  return request<Webhook[]>(base(projectId));
}

/** `secret` is only ever returned here — the receiving service needs it to verify signatures. */
export function createWebhook(
  projectId: string,
  input: { url: string; format: WebhookFormat; events: WebhookEvent[] },
): Promise<{ webhook: Webhook; secret: string }> {
  return request<{ webhook: Webhook; secret: string }>(base(projectId), { method: "POST", body: input });
}

export function setWebhookEnabled(projectId: string, id: string, enabled: boolean): Promise<Webhook> {
  return request<Webhook>(`${base(projectId)}/${id}`, { method: "PATCH", body: { enabled } });
}

export function deleteWebhook(projectId: string, id: string): Promise<void> {
  return request<void>(`${base(projectId)}/${id}`, { method: "DELETE" });
}

export function testWebhook(projectId: string, id: string): Promise<WebhookDelivery> {
  return request<WebhookDelivery>(`${base(projectId)}/${id}/test`, { method: "POST" });
}

export function fetchWebhookDeliveries(projectId: string, id: string): Promise<WebhookDelivery[]> {
  return request<WebhookDelivery[]>(`${base(projectId)}/${id}/deliveries`);
}
