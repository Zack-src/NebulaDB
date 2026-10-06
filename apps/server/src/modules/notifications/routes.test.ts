import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as decoding from "lib0/decoding.js";

process.env.NEBULADB_DB_PATH = join(tmpdir(), `nebuladb-test-notifications-${randomUUID()}.sqlite`);
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms, notifyProject } = await import("../../realtime/roomRegistry.js");

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
  return { id, cookie: `nebuladb_sid=${res.cookies.find((c) => c.name === "nebuladb_sid")!.value}` };
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

    // What an account follows is part of its personal-data export.
    const exported = (await call(app, editor.cookie, "GET", "/api/users/me/export")).json() as {
      subscriptions: { scopeType: string; scopeId: string; events: string[] }[];
    };
    assert.deepEqual(exported.subscriptions, [
      { scopeType: "project", scopeId: project.id, events: ["deployment", "lock", "seed"] },
    ]);

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
    const targetFile = join(mkdtempSync(join(tmpdir(), "nebuladb-notif-")), "shop.sqlite");
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

/** The project's socket as a browser opens it, and the server notices (WebSocket message type 2) it has received so far. */
async function openProject(app: App, cookie: string, projectId: string) {
  const notices: { type: string }[] = [];
  const socket = await app.injectWS(
    `/ws/${projectId}`,
    { headers: headers({ cookie }) },
    {
      onInit: (ws) =>
        ws.on("message", (data: Buffer) => {
          const decoder = decoding.createDecoder(new Uint8Array(data));
          if (decoding.readVarUint(decoder) === 2) notices.push(JSON.parse(decoding.readVarString(decoder)));
        }),
    },
  );
  return { socket, types: () => notices.map((notice) => notice.type) };
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("notifications: a follower with the project open is told at once — and nobody else in the room is", async () => {
  const app = await buildApp();
  await app.ready();
  const sockets: { terminate: () => void }[] = [];
  try {
    const owner = await login(app);
    const follower = await login(app);
    const bystander = await login(app);
    const project = (await call(app, owner.cookie, "POST", "/api/projects", { name: "Shop" })).json() as { id: string };
    const base = `/api/projects/${project.id}`;
    await call(app, owner.cookie, "POST", `${base}/import`, { source: "Table customers {\n  id integer [pk]\n}\n" });
    grant(project.id, follower.id, "edit");
    grant(project.id, bystander.id, "edit");
    const [table] = ((await call(app, owner.cookie, "GET", `${base}/content`)).json() as { tables: { id: string }[] })
      .tables;
    // The owner follows locks too: the one who acts gets no notification, so no notice either.
    await call(app, owner.cookie, "PUT", `${base}/subscription`, { events: ["lock"] });
    await call(app, follower.cookie, "PUT", `${base}/subscription`, { events: ["lock"] });

    const ownerTab = await openProject(app, owner.cookie, project.id);
    // Two tabs of the same account: both are told.
    const followerTab = await openProject(app, follower.cookie, project.id);
    const followerOtherTab = await openProject(app, follower.cookie, project.id);
    const bystanderTab = await openProject(app, bystander.cookie, project.id);
    sockets.push(ownerTab.socket, followerTab.socket, followerOtherTab.socket, bystanderTab.socket);

    const locked = await call(app, owner.cookie, "PUT", `${base}/locks/${table.id}`, { level: "structure" });
    assert.equal(locked.statusCode, 200, locked.body);
    // Frames reach a socket in the order they were sent: once this last notice
    // has arrived everywhere, nothing sent before it is still on its way.
    notifyProject(project.id, { type: "lint-changed" });
    for (const tab of [ownerTab, followerTab, followerOtherTab, bystanderTab]) {
      await until(() => tab.types().includes("lint-changed"), "the closing notice");
    }

    assert.deepEqual(followerTab.types(), ["locks-changed", "notification", "lint-changed"]);
    assert.deepEqual(followerOtherTab.types(), ["locks-changed", "notification", "lint-changed"]);
    // Same room, same lock, both told the lock list changed — but not that someone was notified.
    assert.deepEqual(bystanderTab.types(), ["locks-changed", "lint-changed"]);
    assert.deepEqual(ownerTab.types(), ["locks-changed", "lint-changed"]);
  } finally {
    for (const socket of sockets) socket.terminate();
    closeAllRooms();
    await app.close();
  }
});
