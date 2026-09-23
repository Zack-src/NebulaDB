import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-search-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
process.env.ATHANORDB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");

const HOST = "localhost:3001";
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `http://${HOST}`, ...extra });
type App = Awaited<ReturnType<typeof buildApp>>;

async function makeUserAndLogin(app: App) {
  const email = `${randomUUID()}@example.com`;
  const password = "correct horse battery staple";
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin) VALUES (?, ?, ?, 0)").run(
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

async function createFromTemplate(app: App, cookie: string, name: string, template: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: headers({ cookie }),
    payload: { name, template },
  });
  return (res.json() as { id: string }).id;
}

interface Hit {
  projectId: string;
  projectName: string;
  kind: string;
  tableName?: string;
  fieldName?: string;
  enumName?: string;
  rank: number;
}

async function search(app: App, cookie: string, q: string) {
  const res = await app.inject({
    method: "GET",
    url: `/api/search?q=${encodeURIComponent(q)}`,
    headers: headers({ cookie }),
  });
  assert.equal(res.statusCode, 200);
  return res.json() as { hits: Hit[]; truncated: boolean };
}

test("cross-project search: finds tables/columns/enums in every visible project, ranked, never someone else's", async () => {
  const app = await buildApp();
  try {
    const me = await makeUserAndLogin(app);
    const stranger = await makeUserAndLogin(app);
    const shop = await createFromTemplate(app, me, "Shop", "ecommerce");
    await createFromTemplate(app, me, "Accounts", "auth");
    const trashed = await createFromTemplate(app, me, "Old blog", "blog");
    await app.inject({
      method: "PATCH",
      url: `/api/projects/${trashed}`,
      headers: headers({ cookie: me }),
      payload: { status: "trashed" },
    });
    const strangers = await createFromTemplate(app, stranger, "Stranger's SaaS", "saas");
    // A project with no team is open to every logged-in user (see
    // `permissions.ts`); assigning one — which `me` isn't in — is what makes
    // it private, so that's what the search must respect.
    const teamId = randomUUID();
    db.prepare("INSERT INTO teams (id, name) VALUES (?, 'Strangers only')").run(teamId);
    db.prepare("INSERT INTO project_teams (project_id, team_id, permission) VALUES (?, ?, 'edit')").run(
      strangers,
      teamId,
    );
    // …and an open project of someone else's *is* visible, and so searchable.
    await createFromTemplate(app, stranger, "Open to all", "blog");

    // Read from snapshots, not live rooms — the path every idle project takes.
    closeAllRooms();

    const users = await search(app, me, "users");
    assert.deepEqual(
      users.hits.filter((h) => h.kind === "table").map((h) => `${h.projectName}/${h.tableName}`),
      ["Accounts/users", "Open to all/users"],
      "the trashed blog and the team-restricted SaaS both have a `users` table and must not appear",
    );

    const customer = await search(app, me, "customer");
    assert.equal(customer.hits[0].kind, "table", "a table name match ranks before columns of equal rank");
    assert.equal(customer.hits[0].tableName, "customers");
    assert.ok(
      customer.hits.some((h) => h.kind === "field" && h.tableName === "orders" && h.fieldName === "customer_id"),
    );
    assert.ok(customer.hits.every((h) => h.projectId === shop));

    const exact = await search(app, me, "ORDERS");
    assert.equal(exact.hits[0].tableName, "orders");
    assert.equal(exact.hits[0].rank, 0, "case-insensitive exact match");

    const enumHit = await search(app, me, "order_status");
    assert.ok(enumHit.hits.some((h) => h.kind === "enum" && h.enumName === "order_status"));

    assert.deepEqual(await search(app, me, "x"), { hits: [], truncated: false }, "one character is not a search");

    const anonymous = await app.inject({ method: "GET", url: "/api/search?q=users", headers: headers() });
    assert.equal(anonymous.statusCode, 401);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("cross-project search sees a live edit before it reaches the snapshot", async () => {
  const app = await buildApp();
  try {
    const me = await makeUserAndLogin(app);
    const id = await createFromTemplate(app, me, "Live", "auth");
    // An import leaves the room resident; the snapshot write is debounced.
    await app.inject({
      method: "POST",
      url: `/api/projects/${id}/import`,
      headers: headers({ cookie: me }),
      payload: { source: "Table invoices_live {\n  id int [pk]\n  total_amount int\n}\n" },
    });
    const hits = (await search(app, me, "total_amount")).hits;
    assert.equal(hits.length, 1);
    assert.equal(hits[0].tableName, "invoices_live");
  } finally {
    closeAllRooms();
    await app.close();
  }
});
