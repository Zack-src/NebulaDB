import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

/**
 * The retention registry end to end, on real rows: each journal keeps what it
 * must and loses what is past its retention, in batches; the administrator's
 * setting wins over the environment, which wins over the default.
 */

await useTestDatabase("retention");
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
// An environment value the admin setting must override.
process.env.NEBULADB_QUERY_STATS_RETENTION_DAYS = "45";

const { db } = await import("../../infrastructure/db.js");
const { buildApp } = await import("../../app.js");
const { hashPassword } = await import("../auth/password.js");
const { purgeJournal, purgeJournalNow, previewPurge, runRetention, withJournalLock } = await import("./purge.js");
const { RETENTION_POLICIES, findRetentionPolicy, retentionValueProblem } = await import("./registry.js");
const { changeRetention, effectiveRetention, setRetention, readPurgeStates } = await import("./settings.js");

interface AuditRow {
  actor_id: string | null;
  action: string;
  target_id: string;
  detail: string;
}
const auditEntries = async (action: string, targetId: string) =>
  (await db
    .prepare(
      "SELECT actor_id, action, target_id, detail FROM audit_log WHERE action = ? AND target_type = 'retention' AND target_id = ? ORDER BY seq",
    )
    .all(action, targetId)) as AuditRow[];

const policy = (key: string) => findRetentionPolicy(key)!;
const count = async (sql: string, ...params: unknown[]) =>
  ((await db.prepare(`SELECT count(*)::int AS n FROM ${sql}`).get(...params)) as { n: number }).n;

async function makeUser(): Promise<string> {
  const id = randomUUID();
  await db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')").run(id, `${id}@example.com`);
  return id;
}

async function makeProject(owner: string): Promise<string> {
  const id = randomUUID();
  await db.prepare("INSERT INTO projects (id, name, owner_id) VALUES (?, 'P', ?)").run(id, owner);
  return id;
}

async function makeConnection(): Promise<string> {
  const id = randomUUID();
  await db
    .prepare("INSERT INTO db_connections (id, name, engine, config_encrypted) VALUES (?, 'C', 'postgres', 'x')")
    .run(id);
  return id;
}

test("every journal of the registry names tables that exist, with sane bounds", async () => {
  for (const p of RETENTION_POLICIES) {
    const tables = p.unit === "days" ? p.targets.map((t) => t.table) : [p.table];
    for (const table of tables) assert.ok((await count(table)) >= 0, `${p.key}: ${table}`);
    assert.ok(p.min >= 1 && p.min <= p.max, p.key);
    assert.equal(retentionValueProblem(p, p.defaultValue), null, `${p.key}: its default is settable`);
  }
  assert.notEqual(retentionValueProblem(policy("error_log"), 0), null, "a row-capped log is never unbounded");
  assert.equal(retentionValueProblem(policy("audit_log"), 0), null);
  assert.notEqual(retentionValueProblem(policy("audit_log"), 3), null);
  assert.notEqual(retentionValueProblem(policy("audit_log"), 1.5), null);
});

test("the audit log goes in batches, and the preview counts what a purge removes", async () => {
  const before = await count("audit_log");
  for (let i = 0; i < 25; i++) {
    await db
      .prepare("INSERT INTO audit_log (id, action, created_at) VALUES (?, 'project.create', utc_now('-400 days'))")
      .run(randomUUID());
  }
  await db
    .prepare("INSERT INTO audit_log (id, action, created_at) VALUES (?, 'project.create', utc_now('-10 days'))")
    .run(randomUUID());

  assert.equal((await previewPurge(policy("audit_log"), 365)).rows, 25);
  const result = await purgeJournal(policy("audit_log"), 365, { batchSize: 10, pauseMs: 0 });
  assert.equal(result.deleted, 25);
  assert.equal(result.batches, 3, "10 + 10 + 5");
  assert.match(result.cutoff!, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(await count("audit_log"), before + 1);
});

test("days journals spare what must survive: pending deliveries, open drift, recent and referenced deployments", async () => {
  const user = await makeUser();
  const project = await makeProject(user);
  const connection = await makeConnection();

  // Webhook deliveries: ISO dates; a pending one is the retry queue.
  const hook = randomUUID();
  await db
    .prepare(
      "INSERT INTO project_webhooks (id, project_id, url, events, secret_encrypted) VALUES (?, ?, 'https://x', '[]', 'x')",
    )
    .run(hook, project);
  const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
  const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
  for (const [status, at] of [
    ["delivered", old],
    ["failed", old],
    ["pending", old],
    ["delivered", recent],
  ]) {
    await db
      .prepare(
        "INSERT INTO webhook_deliveries (id, webhook_id, event, payload, status, created_at) VALUES (?, ?, 'e', '{}', ?, ?)",
      )
      .run(randomUUID(), hook, status, at);
  }
  assert.equal((await purgeJournal(policy("webhook_deliveries"), 30)).deleted, 2);
  assert.equal(await count("webhook_deliveries WHERE status = 'pending'"), 1);

  // Drift events: kept forever by default; when a duration is set, an open one stays.
  for (const status of ["open", "resolved", "dismissed"]) {
    await db
      .prepare(
        "INSERT INTO drift_events (id, project_id, connection_id, kind, status, detected_at) VALUES (?, ?, ?, 'schema', ?, utc_now('-100 days'))",
      )
      .run(randomUUID(), project, connection, status);
  }
  assert.equal(policy("drift_events").defaultValue, 0);
  assert.equal((await purgeJournal(policy("drift_events"), 0)).deleted, 0);
  assert.equal((await purgeJournal(policy("drift_events"), 30)).deleted, 2);
  assert.equal(await count("drift_events WHERE status = 'open'"), 1);

  // Deployments: the latest 20 per project and database stay, and so does one a rollback points at.
  const ids: string[] = [];
  for (let i = 0; i < 25; i++) {
    const id = randomUUID();
    ids.push(id);
    await db
      .prepare(
        `INSERT INTO deployment_history (id, project_id, connection_id, connection_name, engine, sql, success, created_at, rollback_of)
         VALUES (?, ?, ?, 'C', 'postgres', 'SELECT 1', 1, utc_now('-400 days'), ?)`,
      )
      .run(id, project, connection, i === 24 ? ids[0] : null);
  }
  assert.equal((await purgeJournal(policy("deployment_history"), 0)).deleted, 0, "kept forever by default");
  const deployments = await purgeJournal(policy("deployment_history"), 365);
  assert.equal(deployments.deleted, 4, "25 - the 20 latest - the one a rollback references");
  assert.equal(await count("deployment_history WHERE id = ?", ids[0]), 1);
});

test("health samples and activity: past the retention, and whatever a deleted connection left", async () => {
  const connection = await makeConnection();
  for (const shift of ["-10 days", "-8 days", "-1 days"]) {
    await db
      .prepare(
        "INSERT INTO db_health_samples (connection_id, at, ok, latency_ms) VALUES (?, utc_now(?::interval), 1, 5)",
      )
      .run(connection, shift);
  }
  await db.prepare("INSERT INTO db_health_samples (connection_id, ok, latency_ms) VALUES ('gone', 1, 5)").run();
  assert.equal((await purgeJournal(policy("db_health_samples"), 7)).deleted, 3);
  assert.equal(await count("db_health_samples"), 1);

  await db
    .prepare(
      "INSERT INTO db_counter_samples (connection_id, taken_at, queries_kind) VALUES (?, utc_now('-20 days'), 'q'), (?, utc_now(), 'q')",
    )
    .run(connection, connection);
  assert.equal((await purgeJournal(policy("db_activity"), 14)).deleted, 1);
  assert.equal(await count("db_counter_samples"), 1);
});

test("row-capped journals keep the latest N, per group where they have one", async () => {
  const alice = await makeUser();
  const bob = await makeUser();
  for (const [user, n] of [
    [alice, 15],
    [bob, 5],
  ] as const) {
    for (let i = 0; i < n; i++) {
      await db
        .prepare("INSERT INTO notifications (id, user_id, event, params_json) VALUES (?, ?, 'mention', ?)")
        .run(randomUUID(), user, JSON.stringify({ i }));
    }
  }
  assert.equal((await previewPurge(policy("notifications"), 10)).rows, 5);
  const result = await purgeJournal(policy("notifications"), 10, { batchSize: 2, pauseMs: 0 });
  assert.equal(result.deleted, 5);
  assert.equal(result.batches, 3);
  assert.equal(await count("notifications WHERE user_id = ?", alice), 10);
  assert.equal(await count("notifications WHERE user_id = ?", bob), 5);
  // The newest are the ones left.
  const kept = (await db
    .prepare("SELECT params_json FROM notifications WHERE user_id = ? ORDER BY seq")
    .all(alice)) as { params_json: string }[];
  assert.equal(JSON.parse(kept[0].params_json).i, 5);

  for (let i = 0; i < 120; i++) {
    await db.prepare("INSERT INTO error_log (id, source, message) VALUES (?, 'server', ?)").run(randomUUID(), `e${i}`);
  }
  assert.equal((await purgeJournal(policy("error_log"), 100)).deleted, 20);
});

test("settings: admin over environment over default, and the scheduled pass uses them", async () => {
  const stats = policy("query_stats");
  assert.deepEqual(
    { value: (await effectiveRetention(stats)).value, source: (await effectiveRetention(stats)).source },
    { value: 45, source: "env" },
  );
  assert.equal((await effectiveRetention(policy("audit_log"))).source, "default");

  const admin = await makeUser();
  const { before, after } = await setRetention(stats, 10, admin);
  assert.equal(before.value, 45);
  assert.deepEqual([after.value, after.source, after.envValue, after.updatedBy], [10, "db", 45, admin]);

  // A hand-edited value out of bounds is ignored, not trusted.
  await db.prepare("UPDATE instance_settings SET value = '{\"value\": -3}' WHERE key = 'retention.query_stats'").run();
  assert.equal((await effectiveRetention(stats)).source, "env");
  await setRetention(stats, 10, admin);

  const connection = await makeConnection();
  for (const shift of ["-20 days", "-5 days"]) {
    await db
      .prepare(
        "INSERT INTO query_stats (connection_id, query_hash, day, normalized_sql, last_at) VALUES (?, ?, utc_today(?::interval), 'SELECT ?', utc_now())",
      )
      .run(connection, randomUUID(), shift);
  }
  const results = await runRetention({ pauseMs: 0 });
  assert.equal(results.find((r) => r.key === "query_stats")!.deleted, 1, "10 days from the admin setting, not 45");
  assert.equal(await count("query_stats"), 1);
  const state = (await readPurgeStates()).get("query_stats")!;
  assert.equal(state.trigger, "scheduled");
  assert.equal(state.deleted, 1);
  assert.equal(results.length, RETENTION_POLICIES.length);

  // Back to the environment's value.
  assert.equal((await setRetention(stats, null, admin)).after.source, "env");
});

test("a journal being purged is skipped by the scheduled pass", async () => {
  const results = await withJournalLock("error_log", () => runRetention({ pauseMs: 0 }));
  assert.ok(results);
  assert.equal(
    results.find((r) => r.key === "error_log"),
    undefined,
  );
});

test("audit trail: a change, a manual purge, and one summary per scheduled pass that removed something", async () => {
  const actor = { id: await makeUser(), email: "admin@example.com" };
  const errors = policy("error_log");

  await changeRetention(errors, 100, actor);
  const [changed] = await auditEntries("retention.changed", "error_log");
  assert.equal(changed.actor_id, actor.id);
  assert.equal(changed.detail, "error_log: 2000 rows (default) -> 100 rows (db)");

  for (let i = 0; i < 130; i++) {
    await db.prepare("INSERT INTO error_log (id, source, message) VALUES (?, 'server', 'x')").run(randomUUID());
  }
  const manual = await purgeJournalNow(errors, actor, undefined, { pauseMs: 0 });
  assert.ok(manual);
  assert.equal(manual.value, 100);
  assert.ok(manual.deleted >= 30);
  const [purged] = await auditEntries("retention.purged", "error_log");
  assert.equal(purged.actor_id, actor.id);
  assert.equal(purged.detail, `manual: error_log: ${manual.deleted} row(s) past the latest 100`);
  assert.equal((await readPurgeStates()).get("error_log")!.trigger, "manual");

  // Nothing to remove: no summary entry.
  await runRetention({ pauseMs: 0 });
  const summariesBefore = (await auditEntries("retention.purged", "scheduled")).length;
  await runRetention({ pauseMs: 0 });
  const afterIdle = (await auditEntries("retention.purged", "scheduled")).length;
  assert.equal(afterIdle, summariesBefore, "an idle pass writes nothing");
  await db
    .prepare("INSERT INTO audit_log (id, action, created_at) VALUES (?, 'project.create', utc_now('-500 days'))")
    .run(randomUUID());
  await runRetention({ pauseMs: 0 });
  const summaries = await auditEntries("retention.purged", "scheduled");
  assert.equal(summaries.length, afterIdle + 1);
  const last = summaries.at(-1)!;
  assert.equal(last.actor_id, null);
  assert.match(last.detail, /^scheduled: audit_log: 1 row\(s\) before \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

  // A manual purge while the journal is being purged is refused.
  assert.equal(await withJournalLock("error_log", () => purgeJournalNow(errors, actor)), null);
  await changeRetention(errors, null, actor);
});

const HOST = "localhost:3001";
type App = Awaited<ReturnType<typeof buildApp>>;

async function login(app: App, isAdmin: 0 | 1): Promise<{ id: string; cookie: string }> {
  const id = randomUUID();
  const email = `${id}@example.com`;
  const password = "correct horse battery staple";
  await db
    .prepare("INSERT INTO users (id, email, password_hash, is_admin) VALUES (?, ?, ?, ?)")
    .run(id, email, await hashPassword(password), isAdmin);
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { host: HOST, origin: `http://${HOST}` },
    payload: { email, password },
  });
  return { id, cookie: `nebuladb_sid=${res.cookies.find((c) => c.name === "nebuladb_sid")!.value}` };
}

test("admin API: list, preview, set with bounds and confirmation, purge with confirmation; admins in a browser only", async () => {
  const app = await buildApp();
  try {
    const admin = await login(app, 1);
    const member = await login(app, 0);
    const call = (
      who: { cookie: string } | { bearer: string },
      method: "GET" | "PUT" | "POST",
      url: string,
      payload?: object,
    ) =>
      app.inject({
        method,
        url,
        headers: {
          host: HOST,
          origin: `http://${HOST}`,
          ...("cookie" in who ? { cookie: who.cookie } : { authorization: `Bearer ${who.bearer}` }),
        },
        ...(payload ? { payload } : {}),
      });

    const listed = await call(admin, "GET", "/api/admin/retention");
    assert.equal(listed.statusCode, 200, listed.body);
    const journals = listed.json().journals as { key: string; [k: string]: unknown }[];
    assert.deepEqual(
      journals.map((j) => j.key),
      RETENTION_POLICIES.map((p) => p.key),
    );
    const audit = journals.find((j) => j.key === "audit_log")!;
    assert.equal(audit.value, 365);
    assert.equal(audit.source, "default");
    assert.equal(audit.envVar, "NEBULADB_AUDIT_RETENTION_DAYS");
    assert.equal(audit.confirmBelow, 90);
    assert.equal(typeof audit.rows, "number");
    assert.equal(typeof audit.bytes, "number");
    assert.match(String(audit.oldest), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.equal(journals.find((j) => j.key === "query_stats")!.source, "env");
    assert.equal(journals.find((j) => j.key === "webhook_deliveries")!.unit, "days");
    assert.equal(journals.find((j) => j.key === "notifications")!.unit, "rows");

    // Setting: bounds, forever only where allowed, a confirmation below the audit floor.
    assert.equal((await call(admin, "PUT", "/api/admin/retention/nope", { value: 10 })).statusCode, 404);
    const tooLow = await call(admin, "PUT", "/api/admin/retention/audit_log", { value: 3 });
    assert.equal(tooLow.statusCode, 400);
    assert.equal(tooLow.json().code, "RETENTION_VALUE_INVALID");
    assert.equal(
      (await call(admin, "PUT", "/api/admin/retention/error_log", { value: 0 })).json().code,
      "RETENTION_VALUE_INVALID",
    );
    assert.equal((await call(admin, "PUT", "/api/admin/retention/audit_log", { value: "30" })).statusCode, 400);
    const unconfirmed = await call(admin, "PUT", "/api/admin/retention/audit_log", { value: 30 });
    assert.equal(unconfirmed.json().code, "RETENTION_CONFIRM_REQUIRED");
    const set = await call(admin, "PUT", "/api/admin/retention/audit_log", { value: 30, confirm: true });
    assert.equal(set.statusCode, 200, set.body);
    const journal = set.json().journal;
    assert.deepEqual([journal.value, journal.source, journal.updatedBy.id], [30, "db", admin.id]);
    assert.equal((await call(admin, "PUT", "/api/admin/retention/audit_log", { value: 0 })).json().journal.value, 0);

    // Purge now: preview, then a confirmation naming the journal.
    await setRetention(policy("audit_log"), 30, admin.id);
    await db
      .prepare("INSERT INTO audit_log (id, action, created_at) VALUES (?, 'project.create', utc_now('-60 days'))")
      .run(randomUUID());
    const preview = await call(admin, "GET", "/api/admin/retention/audit_log/preview");
    assert.equal(preview.statusCode, 200);
    assert.ok(preview.json().rows >= 1);
    for (const body of [undefined, { confirm: "error_log" }]) {
      const refused = await call(admin, "POST", "/api/admin/retention/audit_log/purge", body);
      assert.equal(refused.json().code, "RETENTION_CONFIRM_REQUIRED");
    }
    const purged = await call(admin, "POST", "/api/admin/retention/audit_log/purge", { confirm: "audit_log" });
    assert.equal(purged.statusCode, 200, purged.body);
    assert.equal(purged.json().deleted, preview.json().rows);
    assert.equal(purged.json().value, 30);
    const after = (await call(admin, "GET", "/api/admin/retention"))
      .json()
      .journals.find((j: { key: string }) => j.key === "audit_log");
    assert.equal(after.lastPurge.trigger, "manual");
    assert.equal(after.lastPurge.deleted, purged.json().deleted);
    await setRetention(policy("audit_log"), null, admin.id);

    // Not for a member, nor for anyone signed out.
    for (const [method, url, body] of [
      ["GET", "/api/admin/retention", undefined],
      ["GET", "/api/admin/retention/audit_log/preview", undefined],
      ["PUT", "/api/admin/retention/audit_log", { value: 400 }],
      ["POST", "/api/admin/retention/audit_log/purge", { confirm: "audit_log" }],
    ] as const) {
      assert.equal((await call(member, method, url, body)).statusCode, 403, `${method} ${url}`);
      assert.equal((await call({ cookie: "" }, method, url, body)).statusCode, 401, `${method} ${url}`);
    }

    // Nor through an API key, even an administrator's that works on the public API.
    const key = await call(admin, "POST", "/api/keys", {
      name: "ops",
      scopes: ["projects:read", "projects:write", "connections:manage", "teams:manage"],
    });
    assert.equal(key.statusCode, 201, key.body);
    const bearer = key.json().plaintextKey as string;
    assert.equal((await call({ bearer }, "GET", "/api/v1/projects")).statusCode, 200);
    assert.equal((await call({ bearer }, "GET", "/api/admin/retention")).statusCode, 401);
    assert.equal((await call({ bearer }, "PUT", "/api/admin/retention/audit_log", { value: 400 })).statusCode, 401);
    assert.equal(
      (await call({ bearer }, "POST", "/api/admin/retention/audit_log/purge", { confirm: "audit_log" })).statusCode,
      401,
    );
    assert.equal((await effectiveRetention(policy("audit_log"))).source, "default", "nothing changed through the key");
  } finally {
    await app.close();
  }
});
