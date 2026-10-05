import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-accountwatch-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
process.env.ATHANORDB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");
const { setAccountReaderForTests } = await import("./accountWatch.js");
const { canonicalAccountLines } = await import("./accountFingerprint.js");

const HOST = "localhost:3001";
const ORIGIN = `http://${HOST}`;
type App = Awaited<ReturnType<typeof buildApp>>;

async function login(app: App, admin: boolean) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?, ?)").run(
    randomUUID(),
    email,
    await hashPassword(password),
    admin ? 1 : 0,
    admin ? "Ada Admin" : "Bob",
  );
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { host: HOST, origin: ORIGIN },
    payload: { email, password },
  });
  return `athanordb_sid=${res.cookies.find((c) => c.name === "athanordb_sid")!.value}`;
}

function call(app: App, cookie: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: { host: HOST, origin: ORIGIN, cookie },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

interface View {
  events: {
    kind: string;
    status: string;
    accountChanges?: { type: string; principal: string; privilege?: string }[];
  }[];
  accounts: {
    enabled: boolean;
    connections: { connectionId: string; engine: string; referenceAt: string | null; differs: boolean }[];
  } | null;
}

const role = (name: string, grants: string[] = []) => ({
  key: name,
  principal: {
    name,
    kind: "user" as const,
    canLogin: true,
    locked: false,
    superuser: false,
    system: false,
    memberOf: [],
  },
  grants: grants.length
    ? [{ scope: "table" as const, schema: "public", table: "orders", privileges: grants, grantable: false }]
    : [],
});

test("accounts watch: an outside change is an alert, a change through Athanor is not, and only instance administrators see it", async () => {
  const app = await buildApp();
  let reads = 0;
  let state = canonicalAccountLines([role("app", ["SELECT"])]);
  /** Reads answered in order before falling back to `state` — the console's before/after reads. */
  const queue: string[][] = [];
  setAccountReaderForTests(async () => {
    reads++;
    return queue.length ? queue.shift()! : state;
  });
  try {
    const admin = await login(app, true);
    const member = await login(app, false);
    const project = (await call(app, admin, "POST", "/api/projects", { name: "Shop" })).json() as { id: string };
    const base = `/api/projects/${project.id}/monitoring`;
    const conn = (
      await call(app, admin, "POST", "/api/admin/connections", {
        name: "Shop PG",
        engine: "postgres",
        host: "127.0.0.1",
        port: 1,
        database: "shop",
        user: "svc",
        password: "pw",
      })
    ).json().connection.id as string;
    const sqliteConn = (
      await call(app, admin, "POST", "/api/admin/connections", {
        name: "Local file",
        engine: "sqlite",
        filePath: join(mkdtempSync(join(tmpdir(), "athanordb-accounts-")), "x.sqlite"),
      })
    ).json().connection.id as string;
    for (const id of [conn, sqliteConn]) {
      assert.equal(
        (await call(app, admin, "PUT", `/api/admin/connections/${id}/projects`, { projectIds: [project.id] }))
          .statusCode,
        200,
      );
    }
    assert.equal(
      (await call(app, admin, "PUT", `/api/projects/${project.id}/subscription`, { events: ["drift"] })).statusCode,
      200,
    );
    assert.equal(
      (await call(app, member, "PUT", `/api/projects/${project.id}/subscription`, { events: ["drift"] })).statusCode,
      200,
    );

    // Off by default; nothing is read while it is.
    assert.equal((await call(app, admin, "PUT", base, { enabled: true, intervalMinutes: 5 })).statusCode, 200);
    let view = (await call(app, admin, "POST", `${base}/check`)).json() as View;
    assert.equal(view.accounts?.enabled, false);
    assert.equal(reads, 0);
    // A database without accounts (SQLite) is not offered.
    assert.deepEqual(
      view.accounts?.connections.map((c) => c.engine),
      ["postgres"],
    );

    // Only an instance administrator turns it on — not a project member, whatever their level.
    assert.equal((await call(app, member, "PUT", `${base}/accounts`, { enabled: true })).statusCode, 403);
    assert.equal(
      (await call(app, admin, "PUT", `${base}/accounts`, { enabled: "yes" })).json().code,
      "MONITORING_INVALID",
    );
    assert.equal((await call(app, admin, "PUT", `${base}/accounts`, { enabled: true })).statusCode, 200);

    // First read: the reference, no alert.
    view = (await call(app, admin, "POST", `${base}/check`)).json() as View;
    assert.equal(reads, 1);
    assert.ok(view.accounts?.connections[0].referenceAt);
    assert.deepEqual(
      view.events.filter((e) => e.kind === "accounts"),
      [],
    );

    // Someone grants DELETE outside Athanor: one alert, said once.
    state = canonicalAccountLines([role("app", ["SELECT", "DELETE"])]);
    view = (await call(app, admin, "POST", `${base}/check`)).json() as View;
    let accountEvents = view.events.filter((e) => e.kind === "accounts");
    assert.equal(accountEvents.length, 1);
    assert.equal(accountEvents[0].status, "open");
    assert.deepEqual(
      accountEvents[0].accountChanges?.map((c) => `${c.type} ${c.principal} ${c.privilege}`),
      ["privilege-granted app DELETE"],
    );
    assert.equal(view.accounts?.connections[0].differs, true);
    view = (await call(app, admin, "POST", `${base}/check`)).json() as View;
    assert.equal(view.events.filter((e) => e.kind === "accounts").length, 1, "the same state is not reported twice");

    // In the database's journal, and told to followers who administer the project — names left out.
    const journal = (
      await call(app, admin, "GET", `/api/admin/activity?connectionId=${conn}&category=monitoring`)
    ).json() as {
      entries: { action: string; detail: string }[];
    };
    assert.deepEqual(
      journal.entries.map((e) => e.action),
      ["monitoring.accounts"],
    );
    assert.match(journal.entries[0].detail, /app: DELETE on table public\.orders granted/);
    const adminInbox = (await call(app, admin, "GET", "/api/notifications")).json() as {
      notifications: { event: string; params: Record<string, unknown> }[];
    };
    assert.deepEqual(
      adminInbox.notifications.map((n) => [n.event, n.params.kind, n.params.changes]),
      [["drift", "accounts", 1]],
    );
    assert.ok(!JSON.stringify(adminInbox.notifications).includes("DELETE"));
    const memberInbox = (await call(app, member, "GET", "/api/notifications")).json() as { notifications: unknown[] };
    assert.equal(memberInbox.notifications.length, 0, "a viewer of the project is not told");

    // A member who sees the project sees neither the accounts watch nor its findings.
    const memberView = (await call(app, member, "GET", base)).json() as View;
    assert.equal(memberView.accounts, null);
    assert.deepEqual(
      memberView.events.filter((e) => e.kind === "accounts"),
      [],
    );

    // Athanor's console creates a role: read before and after; the reference follows Athanor's change,
    // the outside DELETE stays open — and is not reported again.
    const withAuditors = canonicalAccountLines([role("app", ["SELECT", "DELETE"]), role("auditors")]);
    queue.push(state, withAuditors);
    await call(app, admin, "POST", `/api/admin/connections/${conn}/users`, {
      action: { type: "create", principal: { name: "auditors" }, password: "s3cret-Passw0rd" },
      execute: true,
    });
    for (let i = 0; i < 200 && queue.length > 0; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(queue.length, 0, "the console's change was read around");
    state = withAuditors;
    view = (await call(app, admin, "POST", `${base}/check`)).json() as View;
    accountEvents = view.events.filter((e) => e.kind === "accounts");
    assert.equal(accountEvents.length, 1, "creating a role through Athanor is not an alert");
    assert.equal(accountEvents[0].status, "open", "the outside change is still there");
    // A preview (not executed) reads nothing.
    const before = reads;
    await call(app, admin, "POST", `/api/admin/connections/${conn}/users`, {
      action: { type: "create", principal: { name: "x" }, password: "s3cret-Passw0rd" },
    });
    assert.equal(reads, before);

    // "This is how it should be": instance administrators only; the finding is closed.
    assert.equal((await call(app, member, "POST", `${base}/accounts/accept`, { connectionId: conn })).statusCode, 403);
    view = (await call(app, admin, "POST", `${base}/accounts/accept`, { connectionId: conn })).json() as View;
    assert.deepEqual(
      view.events.filter((e) => e.kind === "accounts").map((e) => e.status),
      ["resolved"],
    );
    view = (await call(app, admin, "POST", `${base}/check`)).json() as View;
    assert.equal(view.events.filter((e) => e.kind === "accounts").length, 1);
    assert.equal(view.accounts?.connections[0].differs, false);

    // The passwords typed in the console never reach the stored state.
    const stored = JSON.stringify(db.prepare("SELECT * FROM account_baselines").all());
    assert.ok(!stored.includes("s3cret"));

    // Unlinking the database drops its reference; deleting the project drops the rest.
    assert.equal(
      (await call(app, admin, "PUT", `/api/admin/connections/${conn}/projects`, { projectIds: [] })).statusCode,
      200,
    );
    assert.equal(
      (await call(app, admin, "PUT", `/api/admin/connections/${sqliteConn}/projects`, { projectIds: [] })).statusCode,
      200,
    );
    assert.equal((await call(app, admin, "DELETE", `/api/admin/connections/${conn}`)).statusCode, 200);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM account_baselines WHERE connection_id = ?").get(conn) as { n: number }).n,
      0,
    );
  } finally {
    setAccountReaderForTests(null);
    closeAllRooms();
    await app.close();
  }
});
