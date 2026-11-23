import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

await useTestDatabase("agentwork");
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");

/**
 * What an AI agent's key does on a project beyond the schema: the canvas (positions, header
 * colours), initial data, type conversion, history, variants and lint rules — each through the
 * app's own checks (`edit`, table locks), and never a review decision nor a project creation.
 */

type App = Awaited<ReturnType<typeof buildApp>>;
type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

const HOST = "localhost:3001";
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `http://${HOST}`, ...extra });
const PASSWORD = "correct horse battery staple";
const AGENT = ["projects:read", "projects:write", "deployments:trigger", "sql:execute"];
const DBML = "Table users {\n  id integer [pk]\n  email varchar\n  active boolean\n}\n";

async function makeUser(app: App) {
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  await db
    .prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, 0, NULL)")
    .run(id, email, await hashPassword(PASSWORD));
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password: PASSWORD },
  });
  return { id, cookie: `nebuladb_sid=${res.cookies.find((c) => c.name === "nebuladb_sid")!.value}` };
}

function call(app: App, auth: string, method: Method, url: string, payload?: unknown) {
  const credentials: Record<string, string> = auth.startsWith("ndb_")
    ? { authorization: `Bearer ${auth}` }
    : { cookie: auth };
  return app.inject({
    method,
    url,
    headers: headers(credentials),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

async function makeKey(app: App, cookie: string, scopes: string[], kind = "agent", projectId?: string) {
  const res = await call(app, cookie, "POST", "/api/keys", { name: "k", scopes, kind, projectId });
  assert.equal(res.statusCode, 201, res.body);
  return res.json().plaintextKey as string;
}

/** A project of `cookie`'s owner, with the `users` table imported. */
async function makeProject(app: App, cookie: string) {
  const created = await call(app, cookie, "POST", "/api/projects", { name: `P ${randomUUID().slice(0, 6)}` });
  const project = created.json() as { id: string; name: string };
  const key = await makeKey(app, cookie, ["projects:read", "projects:write"], "standard");
  const imported = await call(app, key, "POST", `/api/v1/projects/${project.id}/import`, { source: DBML });
  assert.equal(imported.statusCode, 200, imported.body);
  return project;
}

async function snapshot(app: App, cookie: string, projectId: string) {
  const res = await call(app, cookie, "GET", `/api/projects/${projectId}/snapshot`);
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as {
    tables: {
      id: string;
      name: string;
      position: { x: number; y: number };
      style?: { color?: string };
      fields: { name: string; type: string }[];
    }[];
  };
}

const usersOf = async (app: App, cookie: string, projectId: string) =>
  (await snapshot(app, cookie, projectId)).tables.find((t) => t.name === "users")!;

test("an agent moves and colours tables, and update_schema's path still keeps them", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser(app);
    const project = await makeProject(app, owner.cookie);
    const key = await makeKey(app, owner.cookie, AGENT);
    const url = `/api/v1/projects/${project.id}/layout`;

    const moved = await call(app, key, "PATCH", url, {
      tables: [{ table: "users", x: 640, y: 320, color: "#FF0000" }],
    });
    assert.equal(moved.statusCode, 200, moved.body);
    let users = await usersOf(app, owner.cookie, project.id);
    assert.deepEqual(users.position, { x: 640, y: 320 });
    assert.equal(users.style?.color, "#FF0000");

    // A schema import afterwards keeps the layout.
    await call(app, key, "POST", `/api/v1/projects/${project.id}/import`, { source: DBML });
    users = await usersOf(app, owner.cookie, project.id);
    assert.deepEqual(users.position, { x: 640, y: 320 });

    // Remove the colour; refuse what is not a colour, an unknown table, and a key without the scope.
    assert.equal((await call(app, key, "PATCH", url, { tables: [{ table: "users", color: null }] })).statusCode, 200);
    assert.equal((await usersOf(app, owner.cookie, project.id)).style?.color, undefined);
    assert.equal(
      (await call(app, key, "PATCH", url, { tables: [{ table: "users", color: "red; x" }] })).statusCode,
      400,
    );
    assert.equal((await call(app, key, "PATCH", url, { tables: [{ table: "nope", x: 1 }] })).statusCode, 404);
    const reader = await makeKey(app, owner.cookie, ["projects:read"]);
    assert.equal((await call(app, reader, "PATCH", url, { tables: [{ table: "users", x: 1 }] })).statusCode, 403);
  } finally {
    await closeAllRooms();
    await app.close();
  }
});

test("an agent sets, reads and removes initial data, matched by column name, and a full lock stops it", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser(app);
    const project = await makeProject(app, owner.cookie);
    const key = await makeKey(app, owner.cookie, AGENT);
    const url = `/api/v1/projects/${project.id}/seeds/users`;

    const set = await call(app, key, "PUT", url, { content: "email,id,unknown\na@x.io,1,z\nb@x.io,2,z" });
    assert.equal(set.statusCode, 200, set.body);
    assert.equal(set.json().seed.rowCount, 2);
    const read = await call(app, key, "GET", url);
    assert.equal(read.statusCode, 200, read.body);
    const fields = (await usersOf(app, owner.cookie, project.id)) as unknown as {
      fields: { id: string; name: string }[];
    };
    const idOf = (name: string) => fields.fields.find((f) => f.name === name)!.id;
    assert.deepEqual(read.json().seed.options.mapping, [idOf("email"), idOf("id"), null]);
    assert.equal((await call(app, key, "DELETE", url)).statusCode, 200);
    assert.equal((await call(app, key, "GET", url)).statusCode, 404);

    // A `full` lock (placed by the owner, an administrator) freezes the table's data for the agent.
    const admin = await makeKey(app, owner.cookie, ["projects:read", "projects:write"], "standard");
    const locked = await call(app, admin, "PUT", `/api/v1/projects/${project.id}/locks/users`, { level: "full" });
    assert.equal(locked.statusCode, 200, locked.body);
    const refused = await call(app, key, "PUT", url, { content: "id\n1" });
    assert.equal(refused.statusCode, 403, refused.body);
    assert.equal(refused.json().code, "TABLE_LOCKED");
  } finally {
    await closeAllRooms();
    await app.close();
  }
});

test("an agent previews and applies a type conversion; a locked table keeps its types", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser(app);
    const project = await makeProject(app, owner.cookie);
    const key = await makeKey(app, owner.cookie, AGENT);
    const url = `/api/v1/projects/${project.id}/convert-types`;

    const preview = await call(app, key, "POST", url, { target: "clickhouse" });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(preview.json().applied, false);
    assert.ok(
      preview.json().changes.some((c: { field: string; to: string }) => c.field === "active" && c.to === "Bool"),
      preview.body,
    );
    assert.equal(
      (await usersOf(app, owner.cookie, project.id)).fields.find((f) => f.name === "active")!.type,
      "boolean",
    );
    assert.equal((await call(app, key, "POST", url, { target: "nosql-thing" })).statusCode, 400);

    const admin = await makeKey(app, owner.cookie, ["projects:read", "projects:write"], "standard");
    await call(app, admin, "PUT", `/api/v1/projects/${project.id}/locks/users`, { level: "structure" });
    const blocked = await call(app, key, "POST", url, { target: "clickhouse", apply: true });
    assert.equal(blocked.json().code, "TABLE_LOCKED", blocked.body);
    await call(app, admin, "DELETE", `/api/v1/projects/${project.id}/locks/users`);

    const applied = await call(app, key, "POST", url, { target: "clickhouse", apply: true, fields: ["users.active"] });
    assert.equal(applied.statusCode, 200, applied.body);
    assert.equal(applied.json().applied, true);
    const users = await usersOf(app, owner.cookie, project.id);
    assert.equal(users.fields.find((f) => f.name === "active")!.type, "Bool");
    assert.equal(users.fields.find((f) => f.name === "email")!.type, "varchar", "only the field asked for");
  } finally {
    await closeAllRooms();
    await app.close();
  }
});

test("an agent reads a revision, names it and restores it; it reads the lint rules but never decides a review", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser(app);
    const project = await makeProject(app, owner.cookie);
    const key = await makeKey(app, owner.cookie, AGENT);
    const base = `/api/v1/projects/${project.id}`;

    const first = ((await call(app, key, "GET", `${base}/history`)).json().revisions as { id: string }[]).at(-1)!;
    await call(app, key, "POST", `${base}/import`, { source: `${DBML}\nTable orders {\n  id integer [pk]\n}\n` });
    assert.equal((await snapshot(app, owner.cookie, project.id)).tables.length, 2);

    const old = await call(app, key, "GET", `${base}/revisions/${first.id}/export/dbml`);
    assert.equal(old.statusCode, 200, old.body);
    assert.doesNotMatch(old.body, /orders/);
    assert.equal((await call(app, key, "PATCH", `${base}/revisions/${first.id}`, { label: "v1" })).statusCode, 200);
    const restored = await call(app, key, "POST", `${base}/revisions/${first.id}/restore`, {});
    assert.equal(restored.statusCode, 200, restored.body);
    assert.deepEqual(
      (await snapshot(app, owner.cookie, project.id)).tables.map((t) => t.name),
      ["users"],
    );
    assert.equal((await call(app, key, "GET", `${base}/revisions/nope/export/dbml`)).statusCode, 404);

    const rules = await call(app, key, "GET", `${base}/lint/rules`);
    assert.equal(rules.statusCode, 200, rules.body);
    assert.ok(rules.json().settings);

    for (const verb of ["approve", "reject"]) {
      const res = await call(app, key, "POST", `${base}/reviews/${randomUUID()}/${verb}`, {});
      assert.equal(res.json().code, "AGENT_KEY_FORBIDDEN", verb);
    }
  } finally {
    await closeAllRooms();
    await app.close();
  }
});

test("an agent works across variants it may edit, and a key restricted to one project stays in it", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser(app);
    const original = await makeProject(app, owner.cookie);
    const created = await call(app, owner.cookie, "POST", `/api/projects/${original.id}/variants`, {
      name: "Client A",
    });
    assert.equal(created.statusCode, 201, created.body);
    const variant = created.json() as { id: string };
    const key = await makeKey(app, owner.cookie, AGENT);
    const base = `/api/v1/projects/${original.id}`;

    const listed = await call(app, key, "GET", `${base}/variants`);
    assert.equal(listed.statusCode, 200, listed.body);
    assert.ok(
      listed.json().variants.some((v: { id: string }) => v.id === variant.id),
      listed.body,
    );
    assert.equal((await call(app, key, "GET", `${base}/family`)).statusCode, 200);

    await call(app, key, "POST", `${base}/import`, { source: `${DBML}\nTable orders {\n  id integer [pk]\n}\n` });
    const preview = await call(app, key, "POST", `${base}/variants/preview`, { variants: [variant.id] });
    assert.equal(preview.statusCode, 200, preview.body);
    const pushed = await call(app, key, "POST", `${base}/variants/push`, { variants: [variant.id] });
    assert.equal(pushed.statusCode, 200, pushed.body);
    assert.ok(
      (await snapshot(app, owner.cookie, variant.id)).tables.some((t) => t.name === "orders"),
      "the variant received the new table",
    );
    assert.equal((await call(app, key, "GET", `${base}/compare/${variant.id}`)).statusCode, 200);
    const reset = await call(app, key, "POST", `/api/v1/projects/${variant.id}/variant/reset`, { from: "original" });
    assert.equal(reset.statusCode, 200, reset.body);

    // Restricted to the original: the variant is out of its reach.
    const restricted = await makeKey(app, owner.cookie, AGENT, "agent", original.id);
    const out = await call(app, restricted, "POST", `${base}/variants/push`, { variants: [variant.id] });
    assert.equal(out.json().code, "API_KEY_PROJECT_RESTRICTED", out.body);
    const compared = await call(app, restricted, "GET", `${base}/compare/${variant.id}`);
    assert.equal(compared.json().code, "API_KEY_PROJECT_RESTRICTED", compared.body);

    // Another person's variant, not shared with the owner: never written.
    const stranger = await makeUser(app);
    const theirs = await call(app, stranger.cookie, "POST", `/api/projects/${original.id}/variants`, { name: "B" });
    assert.equal(theirs.statusCode, 201, theirs.body);
    const theirId = (theirs.json() as { id: string }).id;
    // Restrict it to its creator so the owner cannot edit it.
    const reader = await makeUser(app);
    await call(app, stranger.cookie, "PUT", `/api/projects/${theirId}/members/${reader.id}`, { permission: "view" });
    const foreign = await call(app, key, "POST", `${base}/variants/push`, { variants: [theirId] });
    const result = foreign.statusCode === 200 ? foreign.json().results[0] : null;
    assert.ok(foreign.statusCode !== 200 || result?.error, foreign.body);
  } finally {
    await closeAllRooms();
    await app.close();
  }
});
