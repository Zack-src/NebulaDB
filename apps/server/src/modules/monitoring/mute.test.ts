import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

await useTestDatabase("mute");
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";
process.env.NEBULADB_PUBLIC_URL = "https://schemas.example.test/";
// Mail is on, but goes to the test sink rather than to this (unreachable) host.
process.env.NEBULADB_SMTP_HOST = "127.0.0.1";
process.env.NEBULADB_SMTP_FROM = "NebulaDB <noreply@example.test>";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { setMailSinkForTests } = await import("../../infrastructure/mailer.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");

const HOST = "localhost:3001";
const ORIGIN = `http://${HOST}`;
type App = Awaited<ReturnType<typeof buildApp>>;
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: ORIGIN, ...extra });

const sent: string[] = [];
setMailSinkForTests((mail) => void sent.push(mail.to));

async function login(app: App, isAdmin: 0 | 1 = 0, displayName = "Alice Admin") {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  await db
    .prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?, ?)")
    .run(id, email, await hashPassword(password), isAdmin, displayName);
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password },
  });
  return { id, email, cookie: `nebuladb_sid=${res.cookies.find((c) => c.name === "nebuladb_sid")!.value}` };
}

const call = (app: App, cookie: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) =>
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

interface Settings {
  mute: { until: string; at: string; by: string; reason: string } | null;
}

test("mute: no notification or e-mail while muted, events still recorded; lifted or expired, alerts return", async () => {
  const app = await buildApp();
  try {
    const owner = await login(app);
    const editor = await login(app);
    const project = (await call(app, owner.cookie, "POST", "/api/projects", { name: "Shop" })).json() as { id: string };
    await grant(project.id, editor.id, "edit");
    const base = `/api/projects/${project.id}`;
    await call(app, owner.cookie, "PUT", `${base}/subscription`, { events: ["drift"], emailDrift: true });
    const targetFile = join(mkdtempSync(join(tmpdir(), "nebuladb-mute-")), "shop.sqlite");
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
      (await call(app, owner.cookie, "POST", `${base}/monitoring/check`)).json() as {
        result: { changes: number };
        events: unknown[];
      };
    const notified = async () =>
      ((await db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?").get(owner.id)) as { n: number })
        .n;

    // Who may mute, and with what.
    const mute = `${base}/monitoring/mute`;
    assert.equal((await call(app, editor.cookie, "PUT", mute, { minutes: 60, reason: "x" })).statusCode, 403);
    for (const bad of [{ minutes: 61, reason: "x" }, { minutes: 60 }, { minutes: 60, reason: "  " }, {}]) {
      const res = await call(app, owner.cookie, "PUT", mute, bad);
      assert.equal(res.json().code, "MONITORING_MUTE_INVALID");
    }
    const muted = await call(app, owner.cookie, "PUT", mute, { minutes: 480, reason: "Migration de nuit" });
    assert.equal(muted.statusCode, 200, muted.body);
    const { mute: set } = muted.json().settings as Settings & Record<string, unknown>;
    assert.equal(set?.by, "Alice Admin");
    assert.equal(set?.reason, "Migration de nuit");
    assert.equal(
      Math.round(
        (Date.parse(set!.until.replace(" ", "T") + "Z") - Date.parse(set!.at.replace(" ", "T") + "Z")) / 60_000,
      ),
      480,
    );
    assert.deepEqual(
      (
        (await db.prepare("SELECT action FROM audit_log WHERE action LIKE 'monitoring.%mute'").all()) as {
          action: string;
        }[]
      ).map((row) => row.action),
      ["monitoring.mute"],
    );

    // Muted: found, recorded, listed — and not announced.
    change("CREATE TABLE audit_copy (id INTEGER)");
    const found = await check();
    assert.equal(found.result.changes, 1);
    assert.equal(found.events.length, 1);
    assert.equal(await notified(), 0);
    assert.equal(sent.length, 0);
    const listed = (await call(app, owner.cookie, "GET", `${base}/monitoring`)).json() as { settings: Settings };
    assert.equal(listed.settings.mute?.reason, "Migration de nuit");

    // Lifted: the next finding is announced again (the one found while muted is not, later).
    const lifted = await call(app, owner.cookie, "DELETE", mute);
    assert.equal(lifted.json().settings.mute, null);
    assert.equal((await call(app, owner.cookie, "DELETE", mute)).statusCode, 200, "lifting twice is harmless");
    change("CREATE TABLE late (id INTEGER)");
    await check();
    assert.equal(await notified(), 1);
    assert.deepEqual(sent, [owner.email]);

    // A mute that has run out is none.
    await call(app, owner.cookie, "PUT", mute, { minutes: 60, reason: "court" });
    await db
      .prepare("UPDATE monitor_settings SET muted_until = '2020-01-01 00:00:00' WHERE project_id = ?")
      .run(project.id);
    assert.equal(
      ((await call(app, owner.cookie, "GET", `${base}/monitoring`)).json() as { settings: Settings }).settings.mute,
      null,
    );
    change("CREATE TABLE third (id INTEGER)");
    await check();
    assert.equal(await notified(), 2);

    // The same under /api/v1.
    const key = (
      await call(app, owner.cookie, "POST", "/api/keys", { name: "mute", scopes: ["projects:write"] })
    ).json().plaintextKey as string;
    const v1 = (method: "PUT" | "DELETE", payload?: unknown) =>
      app.inject({
        method,
        url: `/api/v1/projects/${project.id}/monitoring/mute`,
        headers: { host: HOST, authorization: `Bearer ${key}` },
        ...(payload === undefined ? {} : { payload: payload as object }),
      });
    assert.equal((await v1("PUT", { minutes: 60, reason: "CI" })).json().settings.mute.reason, "CI");
    assert.equal((await v1("DELETE")).json().settings.mute, null);
  } finally {
    await closeAllRooms();
    await app.close();
  }
});

test("mute: a watch imposed from a connection can only be muted by an instance administrator", async () => {
  const app = await buildApp();
  try {
    const owner = await login(app);
    const instanceAdmin = await login(app, 1, "Root");
    const project = (await call(app, owner.cookie, "POST", "/api/projects", { name: "Imposed" })).json() as {
      id: string;
    };
    const base = `/api/projects/${project.id}`;
    const targetFile = join(mkdtempSync(join(tmpdir(), "nebuladb-mute-")), "imposed.sqlite");
    const connId = (
      await call(app, owner.cookie, "POST", `${base}/connections`, {
        name: "Imposed db",
        engine: "sqlite",
        filePath: targetFile,
      })
    ).json().connection.id as string;
    const mute = `${base}/monitoring/mute`;

    // Not imposed yet: the project's administrator may.
    assert.equal((await call(app, owner.cookie, "PUT", mute, { minutes: 60, reason: "avant" })).statusCode, 200);
    await call(app, owner.cookie, "DELETE", mute);

    await db.prepare("UPDATE db_connections SET monitor_forced = 1 WHERE id = ?").run(connId);
    const refused = await call(app, owner.cookie, "PUT", mute, { minutes: 60, reason: "contourner" });
    assert.equal(refused.statusCode, 403);
    assert.equal(refused.json().code, "MONITORING_MUTE_LOCKED");

    const done = await call(app, instanceAdmin.cookie, "PUT", mute, { minutes: 1440, reason: "Maintenance annoncée" });
    assert.equal(done.statusCode, 200, done.body);
    assert.equal(done.json().settings.mute.by, "Root");
    // Lifting only brings the alerts back: the project's administrator may.
    assert.equal((await call(app, owner.cookie, "DELETE", mute)).json().settings.mute, null);
  } finally {
    await closeAllRooms();
    await app.close();
  }
});
