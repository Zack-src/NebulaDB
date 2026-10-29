import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

await useTestDatabase("acknowledge");
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");

const HOST = "localhost:3001";
const ORIGIN = `http://${HOST}`;
type App = Awaited<ReturnType<typeof buildApp>>;
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: ORIGIN, ...extra });

async function login(app: App) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  await db
    .prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, 0, ?)")
    .run(id, email, await hashPassword(password), "Alice Admin");
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password },
  });
  return { id, cookie: `nebuladb_sid=${res.cookies.find((c) => c.name === "nebuladb_sid")!.value}` };
}

const call = (app: App, cookie: string, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: headers({ cookie }),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

async function grant(projectId: string, userId: string, permission: string): Promise<void> {
  const teamId = randomUUID();
  await db.prepare("INSERT INTO teams (id, name) VALUES (?, ?)").run(teamId, `team-${teamId}`);
  await db.prepare("INSERT INTO team_members (team_id, user_id) VALUES (?, ?)").run(teamId, userId);
  await db
    .prepare("INSERT INTO project_teams (project_id, team_id, permission) VALUES (?, ?, ?)")
    .run(projectId, teamId, permission);
}

interface Event {
  id: string;
  status: string;
  acknowledgement: { by: string; at: string; note: string | null } | null;
}
interface Drift {
  acknowledgement: Event["acknowledgement"];
}

test("acknowledge: an administrator takes note of an open finding — it stays open, and a different change is new", async () => {
  const app = await buildApp();
  try {
    const owner = await login(app);
    const editor = await login(app);
    const project = (await call(app, owner.cookie, "POST", "/api/projects", { name: "Shop" })).json() as { id: string };
    await grant(project.id, editor.id, "edit");
    const base = `/api/projects/${project.id}`;
    const targetFile = join(mkdtempSync(join(tmpdir(), "nebuladb-ack-")), "shop.sqlite");
    const connId = (
      await call(app, owner.cookie, "POST", `${base}/connections`, {
        name: "Shop db",
        engine: "sqlite",
        filePath: targetFile,
      })
    ).json().connection.id as string;
    await call(app, owner.cookie, "POST", `${base}/connections/${connId}/apply-deployment`, {});
    const change = (sql: string) => {
      const target = new Database(targetFile);
      target.exec(sql);
      target.close();
    };
    const check = async () =>
      (await call(app, owner.cookie, "POST", `${base}/monitoring/check`)).json() as { events: Event[] };
    const drift = async () =>
      ((await call(app, editor.cookie, "GET", `${base}/drift`)).json().connections as Drift[])[0];

    change("CREATE TABLE audit_copy (id INTEGER)");
    const first = (await check()).events[0];
    assert.equal(first.acknowledgement, null);
    assert.equal((await drift()).acknowledgement, null);

    const ack = `${base}/monitoring/events/${first.id}/acknowledge`;
    assert.equal((await call(app, editor.cookie, "POST", ack, {})).statusCode, 403, "administrators only");
    assert.equal((await call(app, owner.cookie, "POST", ack, { note: "x".repeat(501) })).statusCode, 400);
    assert.equal(
      (await call(app, owner.cookie, "POST", `${base}/monitoring/events/${randomUUID()}/acknowledge`, {})).json().code,
      "MONITORING_EVENT_NOT_FOUND",
    );

    const done = await call(app, owner.cookie, "POST", ack, { note: "Migration en cours, voir ticket 42" });
    assert.equal(done.statusCode, 200, done.body);
    const acknowledged = (done.json().events as Event[]).find((e) => e.id === first.id)!;
    assert.equal(acknowledged.status, "open", "neither resolved nor ignored");
    assert.equal(acknowledged.acknowledgement?.by, "Alice Admin");
    assert.equal(acknowledged.acknowledgement?.note, "Migration en cours, voir ticket 42");
    assert.ok(acknowledged.acknowledgement?.at);
    assert.equal((await drift()).acknowledgement?.by, "Alice Admin", "the banner can quiet itself");
    const again = await call(app, owner.cookie, "POST", ack, {});
    assert.equal(again.statusCode, 409);
    assert.equal(again.json().code, "MONITORING_EVENT_NOT_OPEN");
    const audited = (await db
      .prepare("SELECT detail FROM audit_log WHERE action = 'monitoring.acknowledge'")
      .all()) as {
      detail: string;
    }[];
    assert.deepEqual(
      audited.map((row) => row.detail),
      ["external: Migration en cours, voir ticket 42"],
    );

    // Another change on the same database is a new finding, not acknowledged — the banner nags again.
    change("CREATE TABLE late (id INTEGER)");
    const events = (await check()).events;
    assert.equal(events[0].acknowledgement, null);
    assert.notEqual(events[0].id, first.id);
    assert.equal((await drift()).acknowledgement, null);

    // Settled findings cannot be acknowledged.
    await call(app, owner.cookie, "POST", `${base}/connections/${connId}/drift/dismiss`);
    assert.equal(
      (await call(app, owner.cookie, "POST", `${base}/monitoring/events/${events[0].id}/acknowledge`, {})).statusCode,
      409,
    );

    // The same under /api/v1: needs a key that may write.
    change("CREATE TABLE third (id INTEGER)");
    const third = (await check()).events[0];
    const key = async (scopes: string[]) =>
      (await call(app, owner.cookie, "POST", "/api/keys", { name: "ack", scopes })).json().plaintextKey as string;
    const withKey = (plaintext: string, url: string, payload: unknown) =>
      app.inject({
        method: "POST",
        url,
        headers: { host: HOST, authorization: `Bearer ${plaintext}` },
        payload: payload as object,
      });
    const v1 = `/api/v1/projects/${project.id}/monitoring/events/${third.id}/acknowledge`;
    assert.equal((await withKey(await key(["projects:read"]), v1, {})).statusCode, 403);
    const viaKey = await withKey(await key(["projects:read", "projects:write"]), v1, { note: "CI" });
    assert.equal(viaKey.statusCode, 200, viaKey.body);
    assert.equal(viaKey.json().event.acknowledgement.note, "CI");
  } finally {
    await closeAllRooms();
    await app.close();
  }
});
