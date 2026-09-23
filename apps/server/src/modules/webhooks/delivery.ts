import crypto from "node:crypto";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { isBlockedAddress } from "../connections/hostGuard.js";
import type { WebhookEvent, WebhookFormat } from "./repository.js";

/**
 * One HTTP delivery of one webhook payload.
 *
 * `node:http`/`https` rather than `fetch`, for two SSRF reasons:
 * - **No redirects.** `fetch` follows them by default, so a harmless-looking
 *   URL could bounce the server anywhere; a 3xx here is just a failed
 *   delivery.
 * - **The address is checked at connect time.** The `lookup` hook below sees
 *   the exact IP the socket is about to use and refuses the cloud metadata
 *   endpoints (`isBlockedAddress`) — unlike a resolve-then-connect check,
 *   there's no window for DNS to answer differently the second time.
 *
 * Like database connections, private/LAN targets stay allowed on purpose: a
 * self-hosted instance posting to an internal chat or CI server is the
 * normal case. Only project administrators can register a webhook.
 */

export const DELIVERY_TIMEOUT_MS = 10_000;
export const USER_AGENT = "AthanorDB-Webhooks/1";

export interface WebhookEnvelope {
  id: string;
  event: WebhookEvent;
  occurredAt: string;
  project: { id: string; name: string; url: string | null };
  data: Record<string, unknown>;
}

const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as dns.LookupAddress[];
    const blocked = list.find((entry) => isBlockedAddress(entry.address));
    if (blocked) {
      return callback(
        Object.assign(new Error(`refusing to deliver to ${blocked.address}`), { code: "EBLOCKED" }),
        "",
        4,
      );
    }
    if (options.all) return callback(null, list as unknown as string, 4);
    return callback(null, list[0].address, list[0].family);
  });
};

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
      return `🔔 Test du webhook AthanorDB pour « ${name} »${link}`;
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
    // Node skips `lookup` entirely for a literal IP, so the guard above never
    // sees `http://169.254.169.254/` — check that case here.
    const literalHost = target.hostname.replace(/^\[|\]$/g, "");
    if (isIP(literalHost) && isBlockedAddress(literalHost)) {
      resolve({ ok: false, status: null, error: `refusing to deliver to ${literalHost}` });
      return;
    }
    const client = target.protocol === "https:" ? https : http;
    const req = client.request(
      target,
      {
        method: "POST",
        lookup: guardedLookup,
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
    req.on("timeout", () => req.destroy(new Error(`timed out after ${DELIVERY_TIMEOUT_MS / 1000}s`)));
    req.on("error", (err: NodeJS.ErrnoException) => {
      resolve({ ok: false, status: null, error: err.code === "EBLOCKED" ? err.message : err.message.slice(0, 200) });
    });
    req.end(body);
  });
}
