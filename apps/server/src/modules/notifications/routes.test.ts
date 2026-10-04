import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-notifications-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
process.env.ATHANORDB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");

const HOST = "localhost:3001";
type App = Awaited<ReturnType<typeof buildApp>>;
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `http://${HOST}`, ...extra });

async function login(app: App) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, 0, NULL)").run(
    id,
    email,
    await hashPassword(password),
  );
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password },
  });
  return { id, cookie: `athanordb_sid=${res.cookies.find((c) => c.name === "athanordb_sid")!.value}` };
}

const call = (app: App, cookie: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: headers({ cookie }),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

function grant(projectId: string, userId: string, permission: string): string {
  const teamId = randomUUID();
  db.prepare("INSERT INTO teams (id, name) VALUES (?, ?)").run(teamId, `team-${teamId}`);
  db.prepare("INSERT INTO team_members (team_id, user_id) VALUES (?, ?)").run(teamId, userId);
  db.prepare("INSERT INTO project_teams (project_id, team_id, permission) VALUES (?, ?, ?)").run(
    projectId,
    teamId,
    permission,
  );
  return teamId;
}

interface Inbox {
  unread: number;
  notifications: { id: string; event: string; params: Record<string, unknown>; read: boolean; projectName: string }[];
}

test("notifications: followers are told what happened — not their own doing, not what they cannot see", async () => {
  const app = await buildApp();
  try {
    const owner = await login(app);
    const coAdmin = await login(app);
    const editor = await login(app);
    const viewer = await login(app);
    const stranger = await login(app);
    const project = (await call(app, owner.cookie, "POST", "/api/projects", { name: "Shop" })).json() as { id: string };
    const base = `/api/projects/${project.id}`;
    await call(app, owner.cookie, "POST", `${base}/import`, {
      source: "Table customers {\n  id integer [pk]\n  name varchar(40)\n}\n",
    });
    grant(project.id, coAdmin.id, "administrator");
    grant(project.id, editor.id, "edit");
    const viewerTeam = grant(project.id, viewer.id, "view");
    const table = (
      (await call(app, owner.cookie, "GET", `${base}/content`)).json() as {
        tables: { id: string; fields: { id: string }[] }[];
      }
    ).tables[0];

    const follow = (who: { cookie: string }, events: unknown) =>
      call(app, who.cookie, "PUT", `${base}/subscription`, { events });
    const inbox = async (who: { cookie: string }) =>
      (await call(app, who.cookie, "GET", "/api/notifications")).json() as Inbox;
    const events = async (who: { cookie: string }) => (await inbox(who)).notifications.map((n) => n.event);

    // Following is one's own business, on a project one can see, among known events.
    assert.equal((await follow(stranger, ["lock"])).statusCode, 403);
    assert.equal((await follow(editor, ["lock", "earthquake"])).statusCode, 400);
    assert.equal((await call(app, editor.cookie, "GET", `${base}/subscription`)).json().subscription, null);
    assert.deepEqual((await follow(editor, ["seed", "lock", "deployment"])).json().subscription, {
      events: ["deployment", "lock", "seed"],
    });
    await follow(viewer, ["lock"]);
    await follow(owner, ["lock", "seed"]);
    await follow(coAdmin, ["deployment"]);

    // A lock: everyone who follows locks, except the one who placed it.
    await call(app, owner.cookie, "PUT", `${base}/locks/${table.id}`, { level: "structure" });
    assert.deepEqual(await events(owner), []);
    assert.deepEqual(await events(viewer), ["lock"]);
    const editorInbox = await inbox(editor);
    assert.equal(editorInbox.unread, 1);
    assert.equal(editorInbox.notifications[0].projectName, "Shop");
    assert.deepEqual(
      [editorInbox.notifications[0].params.locked, editorInbox.notifications[0].params.table],
      [true, "customers"],
    );
    await call(app, owner.cookie, "DELETE", `${base}/locks/${table.id}`);
    assert.deepEqual(await events(viewer), ["lock", "lock"]);

    // A seed set by the editor reaches the owner, who follows seeds — not the viewer, who does not.
    const seeded = await call(app, editor.cookie, "PUT", `${base}/seeds/${table.id}`, {
      content: "id,name\n1,Ada",
      options: { separator: ",", header: true, mapping: table.fields.map((field) => field.id), mode: "if-empty" },
    });
    assert.equal(seeded.statusCode, 200, seeded.body);
    assert.deepEqual(await events(owner), ["seed"]);
    assert.equal((await inbox(owner)).notifications[0].params.rows, 1);
    assert.deepEqual(await events(viewer), ["lock", "lock"]);

    // A deployment: the history is the administrators' — the editor follows it and is told nothing.
    const targetFile = join(mkdtempSync(join(tmpdir(), "athanordb-notif-")), "shop.sqlite");
    const connId = (
      await call(app, owner.cookie, "POST", `${base}/connections`, {
        name: "Dev",
        engine: "sqlite",
        filePath: targetFile,
      })
    ).json().connection.id as string;
    const deployed = await call(app, owner.cookie, "POST", `${base}/connections/${connId}/apply-deployment`, {
      resolutions: {},
    });
    assert.equal(deployed.statusCode, 200, deployed.body);
    assert.deepEqual(await events(editor), ["lock", "lock"]);
    const adminInbox = await inbox(coAdmin);
    assert.deepEqual(
      adminInbox.notifications.map((n) => [n.event, n.params.kind, n.params.connection, n.params.success]),
      [["deployment", "deploy", "Dev", true]],
    );

    // Read: some, then all — and only one's own.
    const [latest] = (await inbox(editor)).notifications;
    const foreign = await call(app, viewer.cookie, "POST", "/api/notifications/read", { ids: [latest.id] });
    assert.equal(foreign.json().marked, 0);
    const one = (
      await call(app, editor.cookie, "POST", "/api/notifications/read", { ids: [latest.id] })
    ).json() as Inbox & { marked: number };
    assert.deepEqual([one.marked, one.unread], [1, 1]);
    assert.equal((await call(app, editor.cookie, "POST", "/api/notifications/read", {})).json().unread, 0);

    // A grant that is gone, and a subscription that was ended, tell nothing more.
    db.prepare("DELETE FROM project_teams WHERE team_id = ?").run(viewerTeam);
    assert.equal((await follow(editor, [])).json().subscription, null);
    await call(app, owner.cookie, "PUT", `${base}/locks/${table.id}`, { level: "full" });
    assert.deepEqual(await events(viewer), ["lock", "lock"]);
    assert.deepEqual(await events(editor), ["lock", "lock"]);

    // Everything goes with the project.
    await call(app, owner.cookie, "DELETE", base);
    const left = db
      .prepare("SELECT (SELECT COUNT(*) FROM subscriptions) AS s, (SELECT COUNT(*) FROM notifications) AS n")
      .get() as { s: number; n: number };
    assert.deepEqual(left, { s: 0, n: 0 });
  } finally {
    closeAllRooms();
    await app.close();
  }
});
