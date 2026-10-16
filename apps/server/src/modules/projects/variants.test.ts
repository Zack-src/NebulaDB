import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

await useTestDatabase("projectvariants");
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");

const HOST = "localhost:3001";
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `http://${HOST}`, ...extra });
const PASSWORD = "correct horse battery staple";

const app = await buildApp();
void after(async () => {
  await closeAllRooms();
  await app.close();
});

async function makeUser(isAdmin: 0 | 1 = 0) {
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  await db
    .prepare("INSERT INTO users (id, email, password_hash, is_admin) VALUES (?, ?, ?, ?)")
    .run(id, email, await hashPassword(PASSWORD), isAdmin);
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password: PASSWORD },
  });
  return { id, cookie: `nebuladb_sid=${res.cookies.find((c) => c.name === "nebuladb_sid")!.value}` };
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
async function call(cookie: string, method: Method, url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: headers({ cookie }),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

async function importDbml(cookie: string, projectId: string, source: string) {
  const res = await call(cookie, "POST", `/api/projects/${projectId}/import`, { source });
  assert.equal(res.statusCode, 200, res.body);
}

async function dbml(cookie: string, projectId: string) {
  return (await call(cookie, "GET", `/api/projects/${projectId}/export/dbml`)).body;
}

const ORIGINAL = `Table customers {
  id int [pk]
  name varchar
}

Table orders {
  id int [pk]
  customer_id int [ref: > customers.id]
  total numeric
}
`;

test("variants: a full copy, behind once the original changes, brought up to date where and how one chooses", async () => {
  const owner = await makeUser();
  const base = (await call(owner.cookie, "POST", "/api/projects", { name: "Boutique" })).json() as { id: string };
  await importDbml(owner.cookie, base.id, ORIGINAL);

  // Two clients.
  const created = await call(owner.cookie, "POST", `/api/projects/${base.id}/variants`, {
    name: "Boutique — Client A",
  });
  assert.equal(created.statusCode, 201, created.body);
  const a = created.json() as { id: string; variantOf: string };
  assert.equal(a.variantOf, base.id);
  const b = (
    await call(owner.cookie, "POST", `/api/projects/${base.id}/variants`, { name: "Boutique — Client B" })
  ).json() as {
    id: string;
  };
  assert.equal(await dbml(owner.cookie, a.id), await dbml(owner.cookie, base.id));

  // No variant of a variant.
  const nested = await call(owner.cookie, "POST", `/api/projects/${a.id}/variants`, { name: "x" });
  assert.equal(nested.json().code, "VARIANT_OF_VARIANT");

  // The list says which project is a variant of which.
  const list = (await call(owner.cookie, "GET", "/api/projects")).json() as { id: string; variantOf: string | null }[];
  assert.equal(list.find((p) => p.id === a.id)?.variantOf, base.id);
  assert.equal(list.find((p) => p.id === base.id)?.variantOf, null);

  // Client A makes "name" their own; then the original changes it, and adds a column.
  await importDbml(owner.cookie, a.id, ORIGINAL.replace("name varchar", "name varchar(255)"));
  await importDbml(
    owner.cookie,
    base.id,
    ORIGINAL.replace("name varchar", "name varchar(100)").replace("total numeric", "total numeric\n  status varchar"),
  );

  const variants = (await call(owner.cookie, "GET", `/api/projects/${base.id}/variants`)).json().variants as {
    id: string;
    status: { pending: number; conflicts: number; customizations: number };
  }[];
  assert.deepEqual(
    variants.map((v) => [v.id, v.status]),
    [
      [a.id, { pending: 2, conflicts: 1, customizations: 1 }],
      [b.id, { pending: 2, conflicts: 0, customizations: 0 }],
    ],
  );
  const fromVariant = (await call(owner.cookie, "GET", `/api/projects/${a.id}/variants`)).json();
  assert.equal(fromVariant.original.id, base.id);
  assert.equal(fromVariant.original.name, "Boutique");
  assert.deepEqual(fromVariant.original.status, { pending: 2, conflicts: 1, customizations: 1 });

  const preview = (
    await call(owner.cookie, "POST", `/api/projects/${base.id}/variants/preview`, { variants: [a.id] })
  ).json();
  const changes = preview.variants[0].plan.changes as { key: string; label: string; conflict?: string }[];
  assert.deepEqual(changes.map((c) => [c.label, c.conflict ?? null]).sort(), [
    ["customers.name", "variant-changed"],
    ["orders.status", null],
  ]);
  const conflictKey = changes.find((c) => c.conflict)!.key;

  // Sent to A only: A keeps its own "name", takes "status". B is left behind.
  const pushed = await call(owner.cookie, "POST", `/api/projects/${base.id}/variants/push`, {
    variants: [{ id: a.id }],
  });
  assert.equal(pushed.statusCode, 200, pushed.body);
  assert.deepEqual(pushed.json().results[0], { id: a.id, name: "Boutique — Client A", applied: 1, kept: 1 });
  const afterA = await dbml(owner.cookie, a.id);
  assert.match(afterA, /name\s+varchar\(255\)/);
  assert.match(afterA, /status\s+varchar/);
  assert.doesNotMatch(await dbml(owner.cookie, b.id), /status/);

  // A's choice stays A's: nothing left to send. B, sent with the original's "name" taken explicitly.
  const again = (await call(owner.cookie, "GET", `/api/projects/${base.id}/variants`)).json().variants as {
    id: string;
    status: { pending: number };
  }[];
  assert.equal(again.find((v) => v.id === a.id)?.status.pending, 0);
  await call(owner.cookie, "POST", `/api/projects/${base.id}/variants/push`, {
    variants: [{ id: b.id, decisions: { [conflictKey]: "base" } }],
  });
  assert.match(await dbml(owner.cookie, b.id), /name\s+varchar\(100\)/);

  // Original against client: what A has differently.
  const compare = (await call(owner.cookie, "GET", `/api/projects/${base.id}/compare/${a.id}`)).json();
  assert.deepEqual(
    compare.diff.tables.map((t: { name: string; status: string; fields: { name: string; status: string }[] }) => [
      t.name,
      t.status,
      t.fields.map((f) => `${f.name}:${f.status}`),
    ]),
    [["customers", "changed", ["name:changed"]]],
  );

  // Detached: a project of its own, nothing more to receive.
  const detached = await call(owner.cookie, "DELETE", `/api/projects/${a.id}/variant`);
  assert.equal(detached.statusCode, 200, detached.body);
  assert.equal(
    ((await call(owner.cookie, "GET", "/api/projects")).json() as { id: string; variantOf: string | null }[]).find(
      (p) => p.id === a.id,
    )?.variantOf,
    null,
  );
});

test("variants: sending needs the right to edit the variant; seeing it needs the right to see it", async () => {
  const owner = await makeUser();
  const other = await makeUser();
  const base = (await call(owner.cookie, "POST", "/api/projects", { name: "Socle" })).json() as { id: string };
  await importDbml(owner.cookie, base.id, ORIGINAL);
  // The other person copies the original they may see, and owns the copy.
  await db
    .prepare("INSERT INTO project_members (project_id, user_id, permission) VALUES (?, ?, 'view')")
    .run(base.id, other.id);
  const theirs = (
    await call(other.cookie, "POST", `/api/projects/${base.id}/variants`, { name: "Leur variante" })
  ).json() as {
    id: string;
  };
  // Their variant is theirs only: a grant of their own makes it restricted.
  await db
    .prepare("INSERT INTO project_members (project_id, user_id, permission) VALUES (?, ?, 'administrator')")
    .run(theirs.id, other.id);
  await importDbml(owner.cookie, base.id, `${ORIGINAL}\nTable extra {\n  id int [pk]\n}\n`);

  // The owner of the original does not see a variant they were not given.
  const ownerList = (await call(owner.cookie, "GET", `/api/projects/${base.id}/variants`)).json().variants;
  assert.deepEqual(ownerList, []);
  const refused = (
    await call(owner.cookie, "POST", `/api/projects/${base.id}/variants/push`, { variants: [theirs.id] })
  ).json();
  assert.equal(refused.results[0].error, "FORBIDDEN");

  // Its owner can.
  const done = (
    await call(other.cookie, "POST", `/api/projects/${base.id}/variants/push`, { variants: [theirs.id] })
  ).json();
  assert.equal(done.results[0].applied, 1);
  assert.match(await dbml(other.cookie, theirs.id), /Table "?extra"?/);

  const bad = await call(owner.cookie, "POST", `/api/projects/${base.id}/variants/push`, { variants: "nope" });
  assert.equal(bad.json().code, "VARIANT_TARGETS_INVALID");
  const foreign = await call(owner.cookie, "POST", `/api/projects/${base.id}/variants/preview`, {
    variants: [base.id],
  });
  assert.equal(foreign.json().code, "VARIANT_NOT_FOUND");
});

test("folders: nested, shared, a project moved in by its administrator, deleting one moves its content up", async () => {
  const alice = await makeUser();
  const bob = await makeUser();
  const admin = await makeUser(1);

  const clients = (await call(alice.cookie, "POST", "/api/project-folders", { name: "Clients" })).json().folder;
  const acme = (await call(alice.cookie, "POST", "/api/project-folders", { name: "Acme", parentId: clients.id })).json()
    .folder;
  assert.equal(acme.parentId, clients.id);
  const empty = (await call(alice.cookie, "POST", "/api/project-folders", { name: "Vide" })).json().folder;

  const project = (await call(alice.cookie, "POST", "/api/projects", { name: "Acme CRM" })).json() as { id: string };
  const moved = await call(alice.cookie, "PUT", `/api/projects/${project.id}/folder`, { folderId: acme.id });
  assert.deepEqual(moved.json(), { folderId: acme.id });
  // A variant lands next to its original.
  const variant = (
    await call(alice.cookie, "POST", `/api/projects/${project.id}/variants`, { name: "Acme CRM — Lyon" })
  ).json();
  const list = (await call(alice.cookie, "GET", "/api/projects")).json() as { id: string; folderId: string | null }[];
  assert.equal(list.find((p) => p.id === variant.id)?.folderId, acme.id);
  // Both restricted to Alice (a project nobody was given is open to everyone).
  for (const id of [project.id, variant.id])
    await db
      .prepare("INSERT INTO project_members (project_id, user_id, permission) VALUES (?, ?, 'administrator')")
      .run(id, alice.id);

  // Bob sees no folder until he can open a project in one — then the way to it, not the empty one.
  assert.deepEqual((await call(bob.cookie, "GET", "/api/project-folders")).json().folders, []);
  await db
    .prepare("INSERT INTO project_members (project_id, user_id, permission) VALUES (?, ?, 'edit')")
    .run(project.id, bob.id);
  const bobs = (await call(bob.cookie, "GET", "/api/project-folders")).json().folders as { name: string }[];
  assert.deepEqual(bobs.map((f) => f.name).sort(), ["Acme", "Clients"]);
  // Not his folder, not his project to move.
  assert.equal(
    (await call(bob.cookie, "PATCH", `/api/project-folders/${acme.id}`, { name: "x" })).json().code,
    "FOLDER_FORBIDDEN",
  );
  assert.equal(
    (await call(bob.cookie, "PUT", `/api/projects/${project.id}/folder`, { folderId: null })).statusCode,
    403,
  );
  // An instance administrator sees them all.
  assert.equal(
    ((await call(admin.cookie, "GET", "/api/project-folders")).json().folders as { id: string }[]).some(
      (f) => f.id === empty.id,
    ),
    true,
  );

  // No folder inside itself.
  const loop = await call(alice.cookie, "PATCH", `/api/project-folders/${clients.id}`, { parentId: acme.id });
  assert.equal(loop.json().code, "FOLDER_MOVE_INVALID");
  const renamed = await call(alice.cookie, "PATCH", `/api/project-folders/${acme.id}`, { name: "Acme SA" });
  assert.equal(renamed.json().folder.name, "Acme SA");

  // Deleting "Clients" puts "Acme SA" at the top; deleting "Acme SA" puts its projects at the top.
  assert.deepEqual((await call(alice.cookie, "DELETE", `/api/project-folders/${clients.id}`)).json(), {
    deleted: true,
    movedProjects: 0,
    movedFolders: 1,
  });
  assert.equal((await call(alice.cookie, "DELETE", `/api/project-folders/${acme.id}`)).json().movedProjects, 2);
  const top = (await call(alice.cookie, "GET", "/api/projects")).json() as { id: string; folderId: string | null }[];
  assert.equal(top.find((p) => p.id === project.id)?.folderId, null);
  assert.equal(
    (await call(alice.cookie, "PUT", `/api/projects/${project.id}/folder`, { folderId: "nope" })).json().code,
    "FOLDER_NOT_FOUND",
  );
});
