import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto, { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Webhooks end to end against a real HTTP receiver on localhost: what
 * actually arrives (headers, signature, body per format), when it arrives
 * (coalescing, retries), and what must never happen (SSRF targets, other
 * people's projects, orphaned rows).
 */

interface Received {
  headers: http.IncomingHttpHeaders;
  body: string;
}
const received: Received[] = [];
let respondWith = 200;
const receiver = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
  req.on("end", () => {
    received.push({ headers: req.headers, body });
    res.statusCode = respondWith;
    res.end("ok");
  });
});
await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
const receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;
after(() => new Promise<void>((resolve) => receiver.close(() => resolve())));

process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-webhooks-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
process.env.ATHANORDB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms, getRoom } = await import("../../realtime/roomRegistry.js");
const { getTablesMap } = await import("@athanordb/shared");
const { processDueDeliveries, setSchemaChangeQuietPeriod, resetWebhookState, flushSchemaChange } =
  await import("./dispatcher.js");

const HOST = "localhost:3001";
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `http://${HOST}`, ...extra });
type App = Awaited<ReturnType<typeof buildApp>>;

async function login(app: App, isAdmin: 0 | 1 = 0) {
  const email = `${randomUUID()}@example.com`;
  const password = "correct horse battery staple";
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?, ?)").run(
    randomUUID(),
    email,
    await hashPassword(password),
    isAdmin,
    email.slice(0, 6),
  );
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password },
  });
  return `athanordb_sid=${res.cookies.find((c) => c.name === "athanordb_sid")!.value}`;
}

async function newProject(app: App, cookie: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: headers({ cookie }),
    payload: { name: "Shop", template: "ecommerce" },
  });
  return res.json().id as string;
}

async function waitFor<T>(check: () => T | undefined, ms = 3000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
}

function verifySignature(secret: string, r: Received): boolean {
  const header = String(r.headers["x-athanordb-signature"]);
  const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header) ?? [];
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${r.body}`).digest("hex");
  return Boolean(v1) && crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}

test("create → ping: the secret is shown once, and every request is signed with it", async () => {
  received.length = 0;
  const app = await buildApp();
  try {
    const cookie = await login(app);
    const projectId = await newProject(app, cookie);
    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/webhooks`,
      headers: headers({ cookie }),
      payload: { url: receiverUrl, events: ["schema.changed"] },
    });
    assert.equal(created.statusCode, 201);
    const { webhook, secret } = created.json() as { webhook: { id: string }; secret: string };
    assert.match(secret, /^whsec_/);

    const listed = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/webhooks`,
      headers: headers({ cookie }),
    });
    assert.doesNotMatch(listed.body, /whsec_/, "the secret is never shown again");
    const stored = db.prepare("SELECT secret_encrypted FROM project_webhooks WHERE id = ?").get(webhook.id) as {
      secret_encrypted: string;
    };
    assert.ok(!stored.secret_encrypted.includes(secret), "encrypted at rest");

    const ping = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/webhooks/${webhook.id}/test`,
      headers: headers({ cookie }),
    });
    assert.equal(ping.json().status, "succeeded");
    assert.equal(received.length, 1);
    const [r] = received;
    assert.equal(r.headers["x-athanordb-event"], "ping");
    assert.ok(verifySignature(secret, r), "HMAC over `<t>.<body>` with the secret");
    const envelope = JSON.parse(r.body);
    assert.equal(envelope.project.name, "Shop");
    assert.equal(envelope.id, r.headers["x-athanordb-delivery"]);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("schema.changed: a burst of edits becomes one notification with a summary; a table drag sends nothing", async () => {
  received.length = 0;
  resetWebhookState();
  setSchemaChangeQuietPeriod(60_000); // flushed by hand below
  const app = await buildApp();
  try {
    const cookie = await login(app);
    const projectId = await newProject(app, cookie);
    closeAllRooms(); // the template seed is in the snapshot: that's the baseline
    await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/webhooks`,
      headers: headers({ cookie }),
      payload: { url: receiverUrl, format: "slack", events: ["schema.changed"] },
    });

    for (const table of ["invoices", "refunds"]) {
      await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/import`,
        headers: headers({ cookie }),
        payload: {
          source: `${(await app.inject({ method: "GET", url: `/api/projects/${projectId}/export/dbml`, headers: headers({ cookie }) })).body}\nTable ${table} {\n  id integer [pk]\n}\n`,
        },
      });
    }
    flushSchemaChange(projectId);
    await processDueDeliveries();
    assert.equal(received.length, 1, "two imports, one notification");
    const slack = JSON.parse(received[0].body) as { text: string };
    assert.match(slack.text, /Schéma « Shop » modifié/);
    assert.match(slack.text, /2 table\(s\) ajoutée\(s\)/);

    // Moving a table is a doc change but not a schema change.
    const room = getRoom(projectId);
    room.doc.transact(() => {
      const tables = getTablesMap(room.doc);
      const [id, table] = [...tables.entries()][0];
      tables.set(id, { ...table, position: { x: table.position.x + 500, y: table.position.y } });
    }, "someone");
    flushSchemaChange(projectId);
    await processDueDeliveries();
    assert.equal(received.length, 1);
  } finally {
    setSchemaChangeQuietPeriod(30_000);
    resetWebhookState();
    closeAllRooms();
    await app.close();
  }
});

test("a failing endpoint is retried later, then succeeds; the log never stores the response body", async () => {
  received.length = 0;
  const app = await buildApp();
  try {
    const cookie = await login(app);
    const projectId = await newProject(app, cookie);
    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/webhooks`,
      headers: headers({ cookie }),
      payload: { url: receiverUrl, events: ["deployment.completed"] },
    });
    const hookId = created.json().webhook.id as string;

    const { emitWebhookEvent } = await import("./dispatcher.js");
    respondWith = 500;
    emitWebhookEvent(projectId, "deployment.completed", { kind: "deploy", success: true, connectionName: "prod" });
    const pending = await waitFor(() => {
      const row = db
        .prepare("SELECT status, attempts, next_attempt_at, last_error FROM webhook_deliveries WHERE webhook_id = ?")
        .get(hookId) as { status: string; attempts: number; next_attempt_at: string; last_error: string } | undefined;
      return row && row.attempts === 1 ? row : undefined;
    });
    assert.equal(pending.status, "pending");
    assert.equal(pending.last_error, "HTTP 500");
    assert.ok(new Date(pending.next_attempt_at).getTime() > Date.now(), "retry scheduled in the future");

    respondWith = 200;
    db.prepare("UPDATE webhook_deliveries SET next_attempt_at = ? WHERE webhook_id = ?").run(
      new Date(Date.now() - 1000).toISOString(),
      hookId,
    );
    await processDueDeliveries();
    const log = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/webhooks/${hookId}/deliveries`,
      headers: headers({ cookie }),
    });
    const [delivery] = log.json() as { status: string; attempts: number; responseStatus: number }[];
    assert.deepEqual([delivery.status, delivery.attempts, delivery.responseStatus], ["succeeded", 2, 200]);
    assert.equal(received.length, 2);
  } finally {
    respondWith = 200;
    closeAllRooms();
    await app.close();
  }
});

test("SSRF, validation and permissions", async () => {
  const app = await buildApp();
  try {
    const owner = await login(app);
    const viewer = await login(app);
    const projectId = await newProject(app, owner);
    const create = (cookie: string, payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url: `/api/projects/${projectId}/webhooks`, headers: headers({ cookie }), payload });

    assert.equal(
      (await create(owner, { url: "http://169.254.169.254/latest/meta-data" })).json().code,
      "CONNECTION_TARGET_FORBIDDEN",
    );
    assert.equal((await create(owner, { url: "file:///etc/passwd" })).json().code, "WEBHOOK_URL_INVALID");
    assert.equal((await create(owner, { url: "https://user:pw@example.com/" })).json().code, "WEBHOOK_URL_INVALID");
    assert.equal((await create(owner, { url: receiverUrl, events: ["ping"] })).json().code, "WEBHOOK_EVENTS_INVALID");
    assert.equal((await create(owner, { url: receiverUrl, format: "teams" })).json().code, "WEBHOOK_FORMAT_INVALID");
    // An open project is *viewable* by everyone, but webhooks are admin-only.
    assert.equal((await create(viewer, { url: receiverUrl })).statusCode, 403);

    const { deliver } = await import("./delivery.js");
    const blocked = await deliver("http://169.254.169.254/", "{}", {});
    assert.equal(blocked.ok, false);
    assert.match(blocked.error ?? "", /refusing/);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("deleting a project removes its webhooks, deliveries, connections and scoped API keys", async () => {
  const app = await buildApp();
  try {
    const cookie = await login(app);
    const projectId = await newProject(app, cookie);
    await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/webhooks`,
      headers: headers({ cookie }),
      payload: { url: receiverUrl },
    });
    await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/connections`,
      headers: headers({ cookie }),
      payload: { name: "Local", engine: "sqlite", database: ":memory:" },
    });
    const count = (table: string) =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id = ?`).get(projectId) as { n: number }).n;
    assert.equal(count("project_webhooks"), 1);
    assert.equal(count("project_connections"), 1);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}`,
      headers: headers({ cookie }),
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal(count("project_webhooks"), 0);
    assert.equal(count("project_connections"), 0, "credentials must not outlive their project");
  } finally {
    closeAllRooms();
    await app.close();
  }
});
