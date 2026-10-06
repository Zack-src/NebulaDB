import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NEBULADB_DB_PATH = join(tmpdir(), `nebuladb-test-activity-${randomUUID()}.sqlite`);
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");
const { activityCategory, AUDIT_ACTIONS } = await import("../../shared/audit.js");

const HOST = "localhost:3001";
const ORIGIN = `http://${HOST}`;
type App = Awaited<ReturnType<typeof buildApp>>;

function headers(extra: Record<string, string> = {}) {
  return { host: HOST, origin: ORIGIN, ...extra };
}

async function login(app: App, isAdmin: 0 | 1) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?, ?)").run(
    randomUUID(),
    email,
    await hashPassword(password),
    isAdmin,
    isAdmin ? "Admin Ada" : null,
  );
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password },
  });
  return `nebuladb_sid=${res.cookies.find((c) => c.name === "nebuladb_sid")!.value}`;
}

function call(app: App, cookie: string, method: "GET" | "POST", url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: headers({ cookie }),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

interface Entry {
  action: string;
  category: string;
  projectName: string | null;
  connectionName: string | null;
  actorName: string | null;
  correlationId: string | null;
}

test("every audited action has a category on purpose", () => {
  const byCategory = new Map<string, string[]>();
  for (const action of AUDIT_ACTIONS) {
    const category = activityCategory(action);
    byCategory.set(category, [...(byCategory.get(category) ?? []), action]);
  }
  assert.equal(activityCategory("connection.deploy"), "deployments");
  assert.equal(activityCategory("table.lock"), "structure");
  assert.equal(activityCategory("dbadmin.query"), "data");
  assert.equal(activityCategory("auth.login.locked"), "sessions");
  assert.equal(activityCategory("dbuser.grant"), "accounts");
  assert.equal(activityCategory("project.delete"), "projects");
  assert.equal(activityCategory("environment.create"), "configuration");
  assert.equal(activityCategory("lint.preset.create"), "configuration");
  assert.ok(
    (byCategory.get("configuration") ?? []).every((a) =>
      /^(connection|dbconn|environment|webhook|instance|lint)\./.test(a),
    ),
    [...(byCategory.get("configuration") ?? [])].join(", "),
  );
});

test("activity: filtered by type, project, connection and text, paged by cursor, exported; administrators only", async () => {
  const app = await buildApp();
  try {
    const admin = await login(app, 1);
    const member = await login(app, 0);
    const project = (await call(app, admin, "POST", "/api/projects", { name: "Shop" })).json() as { id: string };
    const other = (await call(app, admin, "POST", "/api/projects", { name: "Blog" })).json() as { id: string };
    const connection = (
      await call(app, admin, "POST", `/api/projects/${project.id}/connections`, {
        name: "Shop db",
        engine: "sqlite",
        database: ":memory:",
      })
    ).json().connection as { id: string };
    // A detail that a spreadsheet would run.
    await call(app, admin, "POST", `/api/projects/${other.id}/connections`, {
      name: "=HYPERLINK(1)",
      engine: "sqlite",
      database: ":memory:",
    });

    assert.equal((await call(app, member, "GET", "/api/admin/activity")).statusCode, 403);
    assert.equal(
      (await call(app, admin, "GET", "/api/admin/activity?category=nope")).json().code,
      "ACTIVITY_QUERY_INVALID",
    );

    const all = (await call(app, admin, "GET", "/api/admin/activity")).json() as { entries: Entry[] };
    const created = all.entries.find((e) => e.action === "connection.create" && e.connectionName === "Shop db");
    assert.ok(created, "the connection an entry is about is named");
    assert.equal(created.projectName, "Shop");
    assert.equal(created.category, "configuration");
    assert.equal(created.actorName, "Admin Ada");
    assert.ok(created.correlationId);

    const byProject = (await call(app, admin, "GET", `/api/admin/activity?projectId=${project.id}`)).json() as {
      entries: Entry[];
    };
    assert.deepEqual(byProject.entries.map((e) => e.action).sort(), ["connection.create", "project.create"]);
    const byConnection = (
      await call(app, admin, "GET", `/api/admin/activity?connectionId=${connection.id}`)
    ).json() as { entries: Entry[] };
    assert.deepEqual(
      byConnection.entries.map((e) => e.action),
      ["connection.create"],
    );
    const projects = (await call(app, admin, "GET", "/api/admin/activity?category=projects")).json() as {
      entries: Entry[];
    };
    assert.deepEqual(
      projects.entries.map((e) => e.projectName),
      ["Blog", "Shop"],
    );
    const searched = (await call(app, admin, "GET", "/api/admin/activity?search=HYPERLINK")).json() as {
      entries: Entry[];
    };
    assert.equal(searched.entries.length, 1);

    // Pages of one, newest first, without gaps or repeats.
    const seen: string[] = [];
    let cursor: number | null | undefined;
    do {
      const page = (
        await call(app, admin, "GET", `/api/admin/activity?limit=1${cursor ? `&cursor=${cursor}` : ""}`)
      ).json() as { entries: Entry[]; nextCursor: number | null };
      seen.push(...page.entries.map((e) => e.action));
      cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(
      seen,
      all.entries.map((e) => e.action),
    );

    const csv = await call(app, admin, "GET", "/api/admin/activity/export?search=HYPERLINK");
    assert.match(String(csv.headers["content-type"]), /text\/csv/);
    assert.match(csv.body, /^date_utc,category,action,/);
    assert.match(csv.body, /'=HYPERLINK/, "formula-looking cells are defused");
    const json = await call(app, admin, "GET", "/api/admin/activity/export?format=json&category=projects");
    assert.equal((json.json() as Entry[]).length, 2);
  } finally {
    closeAllRooms();
    await app.close();
  }
});
