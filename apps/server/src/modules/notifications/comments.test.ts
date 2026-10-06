import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as decoding from "lib0/decoding.js";

process.env.NEBULADB_DB_PATH = join(tmpdir(), `nebuladb-test-comment-notices-${randomUUID()}.sqlite`);
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

async function login(app: App, displayName: string | null = null) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, 0, ?)").run(
    id,
    email,
    await hashPassword(password),
    displayName,
  );
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password },
  });
  return { id, cookie: `nebuladb_sid=${res.cookies.find((c) => c.name === "nebuladb_sid")!.value}` };
}

const call = (app: App, cookie: string, method: "GET" | "POST", url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: headers({ cookie }),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

/** Puts the account in a team granted on the project — which also makes the project restricted to its teams. */
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
  notifications: { id: string; event: string; params: Record<string, unknown>; projectId: string }[];
}
const inbox = async (app: App, cookie: string) =>
  (await call(app, cookie, "GET", "/api/notifications")).json() as Inbox;
const mention = (name: string, id: string) => `@[${name}](${id})`;

/** The project's socket as a browser opens it, and the server notices (WebSocket message type 2) received so far. */
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

async function shop(app: App, ownerName: string | null = null) {
  const owner = await login(app, ownerName);
  const project = (await call(app, owner.cookie, "POST", "/api/projects", { name: "Shop" })).json() as { id: string };
  return { owner, project, base: `/api/projects/${project.id}` };
}

test("mentionable: only accounts that can see the project, filtered as you type, never the author", async () => {
  const app = await buildApp();
  try {
    const { owner, project, base } = await shop(app, "Olivia");
    const alice = await login(app, "Alice Martin");
    const alicia = await login(app, "Alicia Roy");
    const outsider = await login(app, "Alice Outsider");
    // A team grant makes the project restricted: only its members, the owner and admins see it.
    grant(project.id, alice.id, "edit");
    grant(project.id, alicia.id, "view");

    const all = (await call(app, owner.cookie, "GET", `${base}/mentionable`)).json() as { users: { id: string }[] };
    assert.deepEqual(all.users.map((u) => u.id).sort(), [alice.id, alicia.id].sort());
    assert.ok(!JSON.stringify(all).includes("@example.com"), "no e-mail address is given out");

    const filtered = (await call(app, owner.cookie, "GET", `${base}/mentionable?q=alic`)).json() as {
      users: { id: string; name: string }[];
    };
    assert.deepEqual(
      filtered.users.map((u) => u.name),
      ["Alice Martin", "Alicia Roy"],
    );
    const narrow = (await call(app, owner.cookie, "GET", `${base}/mentionable?q=roy`)).json() as {
      users: { id: string }[];
    };
    assert.deepEqual(
      narrow.users.map((u) => u.id),
      [alicia.id],
    );
    // The outsider is never offered, not even by exact name.
    const exact = (await call(app, owner.cookie, "GET", `${base}/mentionable?q=outsider`)).json() as {
      users: unknown[];
    };
    assert.deepEqual(exact.users, []);
    // `%` is text, not a wildcard.
    const wild = (await call(app, owner.cookie, "GET", `${base}/mentionable?q=%25`)).json() as { users: unknown[] };
    assert.deepEqual(wild.users, []);
    // The author is never offered to themselves.
    const self = (await call(app, alice.cookie, "GET", `${base}/mentionable?q=alice`)).json() as { users: unknown[] };
    assert.deepEqual(self.users, []);
    // Offered to those who may write comments — not to a viewer, nor to someone who cannot see the project.
    assert.equal((await call(app, alicia.cookie, "GET", `${base}/mentionable`)).statusCode, 403);
    assert.equal((await call(app, outsider.cookie, "GET", `${base}/mentionable`)).statusCode, 403);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("comment notices: a mention notifies its person — follower or not — never the author, never someone without access", async () => {
  const app = await buildApp();
  try {
    const { owner, project, base } = await shop(app, "Olivia");
    const editor = await login(app);
    const viewer = await login(app);
    const stranger = await login(app);
    const lost = await login(app);
    grant(project.id, editor.id, "edit");
    grant(project.id, viewer.id, "view");
    const lostTeam = grant(project.id, lost.id, "edit");

    const text = [owner, editor, viewer, stranger, lost].map((p) => mention("someone", p.id)).join(" ");
    // The grant goes between the moment the comment is written and the moment it is announced.
    db.prepare("DELETE FROM project_teams WHERE team_id = ?").run(lostTeam);
    const res = await call(app, owner.cookie, "POST", `${base}/comment-notices`, {
      text,
      tableName: "customers",
      columnName: "email",
      threadUserIds: [],
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { notified: 2 });

    for (const person of [editor, viewer]) {
      const { notifications, unread } = await inbox(app, person.cookie);
      assert.equal(unread, 1);
      assert.equal(notifications[0].event, "mention");
      assert.equal(notifications[0].projectId, project.id);
      // Names only: the author, the table, the column — never the comment itself.
      assert.deepEqual(notifications[0].params, { by: "Olivia", table: "customers", column: "email" });
    }
    for (const person of [owner, stranger, lost]) assert.equal((await inbox(app, person.cookie)).unread, 0);
    // Nobody followed the project: a mention is an address, not a subscription.
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM subscriptions").get() as { n: number };
    assert.equal(n, 0);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("comment notices: a reply reaches those who wrote in the thread; a mention wins over a reply; no self, no lost access", async () => {
  const app = await buildApp();
  try {
    const { owner, project, base } = await shop(app);
    const first = await login(app, "Firsty");
    const second = await login(app);
    const gone = await login(app);
    grant(project.id, first.id, "edit");
    grant(project.id, second.id, "edit");
    const goneTeam = grant(project.id, gone.id, "view");
    db.prepare("DELETE FROM project_teams WHERE team_id = ?").run(goneTeam);

    const res = await call(app, first.cookie, "POST", `${base}/comment-notices`, {
      text: `I agree ${mention("O", owner.id)}`,
      tableName: "orders",
      threadUserIds: [first.id, second.id, owner.id, gone.id, second.id],
    });
    assert.deepEqual(res.json(), { notified: 2 });
    assert.deepEqual(
      (await inbox(app, owner.cookie)).notifications.map((n) => n.event),
      ["mention"],
    );
    const reply = (await inbox(app, second.cookie)).notifications;
    assert.deepEqual(
      reply.map((n) => n.event),
      ["reply"],
    );
    assert.deepEqual(reply[0].params, { by: "Firsty", table: "orders", column: null });
    assert.equal((await inbox(app, first.cookie)).unread, 0);
    assert.equal((await inbox(app, gone.cookie)).unread, 0);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("comment notices: who may announce, what is accepted, and that deleting the account deletes them", async () => {
  const app = await buildApp();
  try {
    const { owner, project, base } = await shop(app);
    const viewer = await login(app);
    const stranger = await login(app);
    grant(project.id, viewer.id, "view");
    const notice = { text: "hi", tableName: "t" };
    assert.equal((await call(app, viewer.cookie, "POST", `${base}/comment-notices`, notice)).statusCode, 403);
    assert.equal((await call(app, stranger.cookie, "POST", `${base}/comment-notices`, notice)).statusCode, 403);
    for (const bad of [
      {},
      { text: "", tableName: "t" },
      { text: "x" },
      { text: "x", tableName: "t", threadUserIds: "no" },
    ]) {
      assert.equal((await call(app, owner.cookie, "POST", `${base}/comment-notices`, bad)).statusCode, 400);
    }
    // A comment with no one to tell is fine.
    assert.deepEqual((await call(app, owner.cookie, "POST", `${base}/comment-notices`, notice)).json(), {
      notified: 0,
    });

    await call(app, owner.cookie, "POST", `${base}/comment-notices`, { text: mention("V", viewer.id), tableName: "t" });
    assert.equal((await inbox(app, viewer.cookie)).unread, 1);
    // The account's own purge (users/repository.ts) removes every notification it holds.
    const { purgeUserAndBelongings } = await import("../users/repository.js");
    purgeUserAndBelongings(viewer.id, "gone@example.com", null);
    const left = db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?").get(viewer.id) as {
      n: number;
    };
    assert.equal(left.n, 0);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("comment notices: a mentioned person with the project open is told at once, the rest of the room is not", async () => {
  const app = await buildApp();
  await app.ready();
  const sockets: { terminate: () => void }[] = [];
  try {
    const { owner, project, base } = await shop(app);
    const mentioned = await login(app);
    const bystander = await login(app);
    grant(project.id, mentioned.id, "edit");
    grant(project.id, bystander.id, "edit");
    const mentionedTab = await openProject(app, mentioned.cookie, project.id);
    const bystanderTab = await openProject(app, bystander.cookie, project.id);
    const ownerTab = await openProject(app, owner.cookie, project.id);
    sockets.push(mentionedTab.socket, bystanderTab.socket, ownerTab.socket);

    await call(app, owner.cookie, "POST", `${base}/comment-notices`, {
      text: mention("M", mentioned.id),
      tableName: "t",
    });
    // Frames arrive in the order they were sent: once this closing notice is
    // everywhere, nothing sent before it is still on its way.
    notifyProject(project.id, { type: "lint-changed" });
    for (const tab of [mentionedTab, bystanderTab, ownerTab]) {
      await until(() => tab.types().includes("lint-changed"), "the closing notice");
    }
    assert.deepEqual(mentionedTab.types(), ["notification", "lint-changed"]);
    assert.deepEqual(bystanderTab.types(), ["lint-changed"]);
    assert.deepEqual(ownerTab.types(), ["lint-changed"]);
  } finally {
    for (const socket of sockets) socket.terminate();
    closeAllRooms();
    await app.close();
  }
});
