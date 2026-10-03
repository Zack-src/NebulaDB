import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-risks-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
process.env.ATHANORDB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms, getRoom } = await import("../../realtime/roomRegistry.js");
const { writeProjectToDoc } = await import("@athanordb/shared");
type Table = import("@athanordb/shared").Table;
type SchemaRisk = import("@athanordb/shared").SchemaRisk;

const HOST = "localhost:3001";
const ORIGIN = `http://${HOST}`;
type App = Awaited<ReturnType<typeof buildApp>>;

function headers(extra: Record<string, string> = {}) {
  return { host: HOST, origin: ORIGIN, ...extra };
}

async function adminCookie(app: App) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, 1, NULL)").run(
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

function call(app: App, cookie: string, method: "GET" | "POST", url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: headers({ cookie }),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

/** A target database: `users` holds a duplicated email and a nickname nobody is going to keep. */
function seedTarget(): string {
  const file = join(mkdtempSync(join(tmpdir(), "athanordb-risks-")), "target.sqlite");
  const target = new Database(file);
  target.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT);
    INSERT INTO users (email, nickname) VALUES ('a@x.io', 'ann'), ('a@x.io', 'bob'), ('c@x.io', NULL);
  `);
  target.close();
  return file;
}

function users(fields: Partial<Table["fields"][number]>[]): Table {
  return {
    id: "t-users",
    name: "users",
    fields: fields.map((field) => ({ id: `f-${field.name}`, type: "text", ...field }) as Table["fields"][number]),
    indexes: [],
    position: { x: 0, y: 0 },
    detailLevel: "standard",
  };
}

function setCanvas(projectId: string, table: Table) {
  const room = getRoom(projectId);
  room.doc.transact(() => {
    writeProjectToDoc(room.doc, {
      id: projectId,
      name: "Shop",
      tables: [table],
      refs: [],
      enums: [],
      zones: [],
      stickyNotes: [],
      tableGroups: [],
    });
  }, "test-seed");
}

async function setup(app: App, cookie: string, environment?: string) {
  const project = (await call(app, cookie, "POST", "/api/projects", { name: "Shop" })).json() as { id: string };
  const connection = (
    await call(app, cookie, "POST", `/api/projects/${project.id}/connections`, {
      name: "Shop db",
      engine: "sqlite",
      filePath: seedTarget(),
      ...(environment ? { environment } : {}),
    })
  ).json().connection as { id: string };
  const base = `/api/projects/${project.id}/connections/${connection.id}`;
  return { projectId: project.id, base };
}

test("risks: a plan reports what it would do to the data, as counts; a duplicate under a new UNIQUE blocks the deployment", async () => {
  const app = await buildApp();
  try {
    const cookie = await adminCookie(app);
    const { projectId, base } = await setup(app, cookie);
    // email becomes unique (two rows share one), nickname goes (two values).
    setCanvas(
      projectId,
      users([
        { name: "id", type: "INTEGER", pk: true },
        { name: "email", unique: true },
      ]),
    );

    const plan = await call(app, cookie, "POST", `${base}/plan-deployment`, {});
    assert.equal(plan.statusCode, 200, plan.body);
    const risks = plan.json().risks as SchemaRisk[];
    const byType = new Map(risks.map((risk) => [risk.type, risk]));
    assert.equal(byType.get("DROP_COLUMN_WITH_DATA")?.affectedRowCount, 2);
    assert.equal(byType.get("UNIQUE_VIOLATION")?.affectedRowCount, 1, "one value duplicated");
    assert.equal(byType.get("UNIQUE_VIOLATION")?.defaultStrategy, "CANCEL");
    assert.ok(
      risks.every((risk) => !("sampleData" in risk)),
      "no row data leaves the database",
    );

    const blocked = await call(app, cookie, "POST", `${base}/apply-deployment`, { resolutions: {} });
    assert.equal(blocked.statusCode, 409);
    assert.equal(blocked.json().code, "DEPLOYMENT_BLOCKED_BY_RISK");
    assert.deepEqual(blocked.json().risks, ["UNIQUE_VIOLATION users.email"]);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("risks: 'cancel' now cancels; accepted risks and the reason are kept with the deployment", async () => {
  const app = await buildApp();
  try {
    const cookie = await adminCookie(app);
    const { projectId, base } = await setup(app, cookie);
    setCanvas(projectId, users([{ name: "id", type: "INTEGER", pk: true }, { name: "email" }]));

    const cancelled = await call(app, cookie, "POST", `${base}/apply-deployment`, {
      resolutions: { "column:users.nickname": { strategy: "CANCEL" } },
    });
    assert.equal(
      cancelled.json().code,
      "DEPLOYMENT_BLOCKED_BY_RISK",
      "the option used to be ignored and the column dropped",
    );

    const deployed = await call(app, cookie, "POST", `${base}/apply-deployment`, {
      resolutions: { "column:users.nickname": { strategy: "DROP_DATA_CONFIRMED" } },
      riskNote: "nicknames move to the profile service",
    });
    assert.equal(deployed.statusCode, 200, deployed.body);
    const [entry] = (await call(app, cookie, "GET", `${base}/history`)).json().history as {
      acceptedRisks?: { type: string; columnName?: string; affectedRowCount: number; strategy: string }[];
      riskNote?: string;
    }[];
    assert.deepEqual(entry.acceptedRisks, [
      {
        type: "DROP_COLUMN_WITH_DATA",
        tableName: "users",
        columnName: "nickname",
        affectedRowCount: 2,
        strategy: "DROP_DATA_CONFIRMED",
      },
    ]);
    assert.equal(entry.riskNote, "nicknames move to the profile service");
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("risks: on the production stage a critical risk needs an explicit answer", async () => {
  const app = await buildApp();
  try {
    const cookie = await adminCookie(app);
    const { projectId, base } = await setup(app, cookie, "Prod");
    setCanvas(projectId, users([{ name: "id", type: "INTEGER", pk: true }, { name: "email" }]));

    const silent = await call(app, cookie, "POST", `${base}/apply-deployment`, { confirmName: "Shop db" });
    assert.equal(silent.statusCode, 409);
    assert.equal(silent.json().code, "DESTRUCTIVE_CHANGE_UNRESOLVED");
    assert.deepEqual(silent.json().risks, ["DROP_COLUMN_WITH_DATA users.nickname"]);

    const kept = await call(app, cookie, "POST", `${base}/apply-deployment`, {
      confirmName: "Shop db",
      resolutions: { "column:users.nickname": { strategy: "KEEP_IN_DB" } },
    });
    assert.equal(kept.statusCode, 200, kept.body);
  } finally {
    closeAllRooms();
    await app.close();
  }
});
