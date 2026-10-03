import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-monitoring-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
process.env.ATHANORDB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms, getRoom } = await import("../../realtime/roomRegistry.js");
const { writeProjectToDoc } = await import("@athanordb/shared");
const { runDueMonitoring } = await import("./monitor.js");

const HOST = "localhost:3001";
const ORIGIN = `http://${HOST}`;
type App = Awaited<ReturnType<typeof buildApp>>;

function headers(extra: Record<string, string> = {}) {
  return { host: HOST, origin: ORIGIN, ...extra };
}

async function login(app: App) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, 0, NULL)").run(
    randomUUID(),
    email,
    await hashPassword(password),
  );
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password },
  });
  return `athanordb_sid=${res.cookies.find((c) => c.name === "athanordb_sid")!.value}`;
}

function call(app: App, cookie: string, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: headers({ cookie }),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

interface Monitoring {
  settings: { enabled: boolean; intervalMinutes: number; lastCheckedAt: string | null };
  events: { kind: string; status: string; added: string[]; changed: string[]; removed: string[] }[];
  result?: { checked: number; changes: number; unreachable: number };
}

test("monitoring: a change made outside Athanor is found once, marked, waved off, and settled by a deployment", async () => {
  const app = await buildApp();
  try {
    const owner = await login(app);
    const project = (await call(app, owner, "POST", "/api/projects", { name: "Shop" })).json() as {
      id: string;
      name: string;
    };
    const room = getRoom(project.id);
    room.doc.transact(() => {
      writeProjectToDoc(room.doc, {
        id: project.id,
        name: project.name,
        tables: [
          {
            id: "t-widgets",
            name: "widgets",
            fields: [{ id: "f-id", name: "id", type: "integer", pk: true }],
            indexes: [],
            position: { x: 0, y: 0 },
            detailLevel: "standard",
          },
        ],
        refs: [],
        enums: [],
        zones: [],
        stickyNotes: [],
        tableGroups: [],
      });
    }, "test-seed");
    const targetFile = join(mkdtempSync(join(tmpdir(), "athanordb-monitor-")), "shop.sqlite");
    const connId = (
      await call(app, owner, "POST", `/api/projects/${project.id}/connections`, {
        name: "Shop db",
        engine: "sqlite",
        filePath: targetFile,
      })
    ).json().connection.id as string;
    const base = `/api/projects/${project.id}`;
    const check = async () => (await call(app, owner, "POST", `${base}/monitoring/check`)).json() as Monitoring;

    // Nothing to compare with before a first deployment.
    assert.deepEqual((await check()).result, { checked: 0, changes: 0, unreachable: 0 });
    assert.equal(
      (await call(app, owner, "POST", `${base}/connections/${connId}/apply-deployment`, {})).statusCode,
      200,
    );

    assert.equal(
      (await call(app, owner, "PUT", `${base}/monitoring`, { enabled: true, intervalMinutes: 7 })).json().code,
      "MONITORING_INVALID",
    );
    const saved = await call(app, owner, "PUT", `${base}/monitoring`, {
      enabled: true,
      intervalMinutes: 5,
      ignoreTables: ["scratch"],
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual((await check()).result, { checked: 1, changes: 0, unreachable: 0 });

    // Someone changes the database with another tool.
    const target = new Database(targetFile);
    target.exec(
      "ALTER TABLE widgets ADD COLUMN colour TEXT; CREATE TABLE audit_copy (id INTEGER); CREATE TABLE scratch (x INTEGER);",
    );
    target.close();

    const found = await check();
    assert.deepEqual(found.result, { checked: 1, changes: 1, unreachable: 0 });
    assert.equal(found.events[0].kind, "external");
    assert.deepEqual(found.events[0].added, ["audit_copy"], "the ignored table is left out");
    assert.deepEqual(found.events[0].changed, ["widgets"]);
    const drift = (await call(app, owner, "GET", `${base}/drift`)).json().connections as {
      outOfSchemaAt: string | null;
      outOfSchemaDetail: string | null;
    }[];
    assert.ok(drift[0].outOfSchemaAt, "the editor's banner comes on");
    assert.match(drift[0].outOfSchemaDetail ?? "", /^external change: \+audit_copy ~widgets/);

    // The same state is not reported twice — neither at the next pass nor by the scheduler.
    assert.equal((await check()).result?.changes, 0);
    db.prepare("UPDATE monitor_settings SET last_checked_at = datetime('now', '-1 hour')").run();
    await runDueMonitoring();
    assert.equal(((await call(app, owner, "GET", `${base}/monitoring`)).json() as Monitoring).events.length, 1);

    // Waved off: not reported again.
    await call(app, owner, "POST", `${base}/connections/${connId}/drift/dismiss`);
    assert.equal((await check()).result?.changes, 0);
    assert.equal(
      ((await call(app, owner, "GET", `${base}/monitoring`)).json() as Monitoring).events[0].status,
      "ignored",
    );

    // A further change is new again; a deployment then settles it.
    const again = new Database(targetFile);
    again.exec("CREATE TABLE late (id INTEGER)");
    again.close();
    const second = await check();
    assert.equal(second.result?.changes, 1);
    assert.equal(
      (await call(app, owner, "POST", `${base}/connections/${connId}/apply-deployment`, {})).statusCode,
      200,
    );
    const after = (await call(app, owner, "GET", `${base}/monitoring`)).json() as Monitoring;
    assert.equal(after.events[0].status, "resolved");
    assert.equal((await check()).result?.changes, 0);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("monitoring: an unreachable database is reported once, never as a change; only administrators set the watch", async () => {
  const app = await buildApp();
  try {
    const owner = await login(app);
    const stranger = await login(app);
    const project = (await call(app, owner, "POST", "/api/projects", { name: "Lab" })).json() as { id: string };
    const targetFile = join(mkdtempSync(join(tmpdir(), "athanordb-monitor-")), "lab.sqlite");
    const connId = (
      await call(app, owner, "POST", `/api/projects/${project.id}/connections`, {
        name: "Lab db",
        engine: "sqlite",
        filePath: targetFile,
      })
    ).json().connection.id as string;
    const base = `/api/projects/${project.id}`;
    await call(app, owner, "POST", `${base}/connections/${connId}/apply-deployment`, {});

    assert.equal(
      (await call(app, stranger, "PUT", `${base}/monitoring`, { enabled: true, intervalMinutes: 5 })).statusCode,
      403,
    );

    // The file moves away: the database cannot be read.
    await call(app, owner, "PUT", `${base}/connections/${connId}`, {
      filePath: join(tmpdir(), randomUUID(), "missing", "lab.sqlite"),
    });
    const first = (await call(app, owner, "POST", `${base}/monitoring/check`)).json() as Monitoring;
    const second = (await call(app, owner, "POST", `${base}/monitoring/check`)).json() as Monitoring;
    assert.equal(first.result?.unreachable, 1);
    assert.equal(first.result?.changes, 0);
    assert.equal(second.events.filter((e) => e.kind === "unreachable").length, 1, "reported once");
    assert.equal(
      ((await call(app, owner, "GET", `${base}/drift`)).json().connections as { outOfSchemaAt: string | null }[])[0]
        .outOfSchemaAt,
      null,
      "not taken for a change",
    );

    await call(app, owner, "PUT", `${base}/connections/${connId}`, { filePath: targetFile });
    const back = (await call(app, owner, "POST", `${base}/monitoring/check`)).json() as Monitoring;
    assert.equal(back.events.find((e) => e.kind === "unreachable")?.status, "resolved");
  } finally {
    closeAllRooms();
    await app.close();
  }
});
