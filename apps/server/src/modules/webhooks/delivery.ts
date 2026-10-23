import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import type { WebhookEvent, WebhookFormat } from "./repository.js";
import { isWebhookAddressRefused, isWebhookHostListed, webhookLookup } from "./targetPolicy.js";

/**
 * One HTTP delivery of one webhook payload, via `node:http`/`https` rather than `fetch`:
 * - **No redirects**: a 3xx is a failed delivery.
 * - **The address is checked at connect time** (`lookup` hook, `targetPolicy.ts`), so DNS
 *   can't answer differently a second time.
 * - **Errors are generic**: a refused connection, a timeout or a DNS failure all read
 *   "delivery failed", so the test button and the log can't be used to scan ports. Only the
 *   receiver's HTTP status is reported.
 *
 * Private/LAN targets are refused by default; an instance can allow them
 * (`NEBULADB_WEBHOOK_BLOCK_PRIVATE=0`), list the hosts that may be targeted
 * (`NEBULADB_WEBHOOK_ALLOWED_HOSTS`, which also exempts them from the private block).
 */

const DELIVERY_TIMEOUT_MS = 10_000;
const USER_AGENT = "NebulaDB-Webhooks/1";
const TARGET_REFUSED = "delivery target not allowed";
const DELIVERY_FAILED = "delivery failed";

export interface WebhookEnvelope {
  id: string;
  event: WebhookEvent;
  occurredAt: string;
  project: { id: string; name: string; url: string | null };
  data: Record<string, unknown>;
}

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">` — the timestamp is signed too, so a captured request can't be replayed later with a fresh one. */
export function signBody(secret: string, body: string, timestamp: number): string {
  const mac = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

function summarize(envelope: WebhookEnvelope): string {
  const name = envelope.project.name;
  const link = envelope.project.url ? ` — ${envelope.project.url}` : "";
  const data = envelope.data;
  switch (envelope.event) {
    case "ping":
      return `🔔 Test du webhook NebulaDB pour « ${name} »${link}`;
    case "schema.changed": {
      const authors = (data.authors as string[] | undefined)?.join(", ") || "quelqu'un";
      const c = data.changes as { tablesAdded: number; tablesRemoved: number; tablesChanged: number } | null;
      const detail = c
        ? ` (${c.tablesAdded} table(s) ajoutée(s), ${c.tablesRemoved} supprimée(s), ${c.tablesChanged} modifiée(s))`
        : "";
      return `✏️ Schéma « ${name} » modifié par ${authors}${detail}${link}`;
    }
    case "deployment.completed": {
      const target = `${data.connectionName}${data.environment ? ` [${data.environment}]` : ""}`;
      return data.success
        ? `🚀 « ${name} » déployé sur ${target} (${data.executedStatements} instruction(s))${link}`
        : `❌ Échec du déploiement de « ${name} » sur ${target} : ${data.error ?? "erreur inconnue"}${link}`;
    }
    case "deployment.review": {
      const target = `${data.connectionName}${data.environment ? ` [${data.environment}]` : ""}`;
      const by = (data.by as string | null) ?? "NebulaDB";
      const said: Record<string, string> = {
        requested: `👀 ${data.requestedBy} demande une revue avant de déployer « ${name} » sur ${target}`,
        approved: `✅ ${by} a approuvé le déploiement de « ${name} » sur ${target} demandé par ${data.requestedBy}`,
        rejected: `⛔ ${by} a rejeté le déploiement de « ${name} » sur ${target} demandé par ${data.requestedBy}`,
        withdrawn: `↩️ ${data.requestedBy} a retiré sa demande de revue pour « ${name} » sur ${target}`,
        expired: `⌛ L'approbation du déploiement de « ${name} » sur ${target} a expiré`,
        stale: `♻️ La demande de revue pour « ${name} » sur ${target} n'est plus à jour : le schéma ou la base a changé`,
        cancelled: `🚫 La demande de revue pour « ${name} » sur ${target} a été annulée`,
      };
      return `${said[String(data.action)] ?? said.cancelled}${link}`;
    }
    case "drift.detected": {
      const target = `${data.connectionName}${data.environment ? ` [${data.environment}]` : ""}`;
      if (data.kind === "accounts") {
        const total = Object.values((data.accountChanges as Record<string, number> | undefined) ?? {}).reduce(
          (sum, n) => sum + n,
          0,
        );
        return `🔐 Comptes ou privilèges de la base ${target} (« ${name} ») modifiés en dehors d'Nebula (${total} changement(s))${link}`;
      }
      const count = ["added", "removed", "changed"].reduce(
        (sum, key) => sum + ((data[key] as string[] | undefined)?.length ?? 0),
        0,
      );
      return `⚠️ La base ${target} de « ${name} » a été modifiée en dehors d'Nebula (${count} table(s))${link}`;
    }
  }
}

/** The request body for `format`: the full envelope, or a chat message built from it. */
export function renderBody(envelope: WebhookEnvelope, format: WebhookFormat): string {
  if (format === "slack") return JSON.stringify({ text: summarize(envelope) });
  if (format === "discord") return JSON.stringify({ content: summarize(envelope) });
  return JSON.stringify(envelope);
}

export interface DeliveryResult {
  ok: boolean;
  status: number | null;
  error: string | null;
}

export function deliver(url: string, body: string, headers: Record<string, string>): Promise<DeliveryResult> {
  return new Promise((resolve) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      resolve({ ok: false, status: null, error: "invalid URL" });
      return;
    }
    const host = target.hostname.replace(/^\[|\]$/g, "");
    // Node skips `lookup` entirely for a literal IP, so the connect-time check
    // never sees `http://169.254.169.254/` — check that case here.
    if (!isWebhookHostListed(host) || (isIP(host) && isWebhookAddressRefused(host, host))) {
      resolve({ ok: false, status: null, error: TARGET_REFUSED });
      return;
    }
    const client = target.protocol === "https:" ? https : http;
    const req = client.request(
      target,
      {
        method: "POST",
        lookup: webhookLookup,
        timeout: DELIVERY_TIMEOUT_MS,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "user-agent": USER_AGENT,
          ...headers,
        },
      },
      (res) => {
        // The body is never read or stored: this is a blind notification, and
        // echoing an internal endpoint's response back to the UI would turn
        // the delivery log into an SSRF read primitive.
        res.resume();
        const status = res.statusCode ?? 0;
        const ok = status >= 200 && status < 300;
        resolve({ ok, status, error: ok ? null : `HTTP ${status}` });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", (err: NodeJS.ErrnoException) => {
      // Never the system message (ECONNREFUSED, EHOSTUNREACH, timeout…): told apart, they
      // map which internal hosts and ports answer.
      resolve({ ok: false, status: null, error: err.code === "EBLOCKED" ? TARGET_REFUSED : DELIVERY_FAILED });
    });
    req.end(body);
  });
}
