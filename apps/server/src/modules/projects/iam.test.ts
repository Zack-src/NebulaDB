import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NEBULADB_DB_PATH = join(tmpdir(), `nebuladb-test-iam-${randomUUID()}.sqlite`);
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { getProjectConnection } = await import("../connections/repository.js");

const HOST = "localhost:3001";
const ORIGIN = `http://${HOST}`;
type App = Awaited<ReturnType<typeof buildApp>>;

function headers(extra: Record<string, string> = {}) {
  return { host: HOST, origin: ORIGIN, ...extra };
}

async function makeUser(app: App, isAdmin: 0 | 1 = 0) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?, NULL)").run(
    id,
    email,
    await hashPassword(password),
    isAdmin,
  );
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password },
  });
  const sid = res.cookies.find((c) => c.name === "nebuladb_sid");
  return { id, email, cookie: `nebuladb_sid=${sid!.value}` };
}

function call(
  app: App,
  cookie: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: object,
) {
  return app.inject({ method, url, headers: headers({ cookie }), ...(payload ? { payload } : {}) });
}

async function makeProject(app: App, cookie: string, name = "Project") {
  const res = await call(app, cookie, "POST", "/api/projects", { name });
  assert.equal(res.statusCode, 201);
  return (res.json() as { id: string }).id;
}

async function makeServer(app: App, cookie: string, host: string) {
  const res = await call(app, cookie, "POST", "/api/admin/connections", {
    name: `Server ${host}`,
    engine: "postgres",
    host,
    port: 5432,
    database: "main",
    user: "deploy",
    password: "secret",
    authMode: "shared",
  });
  assert.equal(res.statusCode, 200, res.body);
  return (res.json() as { connection: { id: string } }).connection.id;
}

test("a level given to one person makes them administrator of a project, and restricts an open one", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser(app);
    const promoted = await makeUser(app);
    const bystander = await makeUser(app);
    const projectId = await makeProject(app, owner.cookie);

    // Nobody assigned: open to every account, in reading.
    assert.equal((await call(app, promoted.cookie, "GET", `/api/projects/${projectId}`)).json().permission, "view");
    // Giving a level is the project administrators' — not anyone who can read it.
    const refused = await call(app, promoted.cookie, "PUT", `/api/projects/${projectId}/members/${promoted.id}`, {
      permission: "administrator",
    });
    assert.equal(refused.statusCode, 403);

    const granted = await call(app, owner.cookie, "PUT", `/api/projects/${projectId}/members/${promoted.id}`, {
      permission: "administrator",
    });
    assert.equal(granted.statusCode, 200);
    assert.equal(
      (await call(app, promoted.cookie, "GET", `/api/projects/${projectId}`)).json().permission,
      "administrator",
    );
    // The first grant made the project private.
    assert.equal((await call(app, bystander.cookie, "GET", `/api/projects/${projectId}`)).statusCode, 403);

    const members = await call(app, owner.cookie, "GET", `/api/projects/${projectId}/members`);
    assert.deepEqual(
      (members.json() as { userId: string; permission: string }[]).map((m) => [m.userId, m.permission]),
      [[promoted.id, "administrator"]],
    );

    const unknown = await call(app, owner.cookie, "PUT", `/api/projects/${projectId}/members/${randomUUID()}`, {
      permission: "edit",
    });
    assert.equal(unknown.statusCode, 400);
    const badLevel = await call(app, owner.cookie, "PUT", `/api/projects/${projectId}/members/${bystander.id}`, {
      permission: "owner",
    });
    assert.equal(badLevel.statusCode, 400);

    assert.equal(
      (await call(app, owner.cookie, "DELETE", `/api/projects/${projectId}/members/${promoted.id}`)).statusCode,
      200,
    );
    assert.equal((await call(app, promoted.cookie, "GET", `/api/projects/${projectId}`)).json().permission, "view");
  } finally {
    await app.close();
  }
});

test("an administrator reads a team's projects and a person's teams and projects", async () => {
  const app = await buildApp();
  try {
    const admin = await makeUser(app, 1);
    const member = await makeUser(app);
    const owned = await makeProject(app, member.cookie, "Owned");
    const shared = await makeProject(app, admin.cookie, "Shared");
    const direct = await makeProject(app, admin.cookie, "Direct");

    const team = (await call(app, admin.cookie, "POST", "/api/teams", { name: "Data" })).json() as { id: string };
    await call(app, admin.cookie, "POST", `/api/teams/${team.id}/members`, { userId: member.id });
    await call(app, admin.cookie, "PUT", `/api/projects/${shared}/teams/${team.id}`, { permission: "edit" });
    await call(app, admin.cookie, "PUT", `/api/projects/${direct}/members/${member.id}`, { permission: "view" });

    const detail = (await call(app, admin.cookie, "GET", `/api/teams/${team.id}`)).json() as {
      projects: { projectId: string; permission: string }[];
    };
    assert.deepEqual(detail.projects, [{ projectId: shared, projectName: "Shared", permission: "edit" }]);

    assert.equal((await call(app, member.cookie, "GET", `/api/users/${member.id}/access`)).statusCode, 403);
    const access = (await call(app, admin.cookie, "GET", `/api/users/${member.id}/access`)).json() as {
      teams: { id: string }[];
      projects: { projectId: string; permission: string | null; owner: boolean }[];
    };
    assert.deepEqual(
      access.teams.map((t) => t.id),
      [team.id],
    );
    assert.deepEqual(
      access.projects.map((p) => [p.projectId, p.permission, p.owner]),
      [
        [direct, "view", false],
        [owned, null, true],
      ],
    );
  } finally {
    await app.close();
  }
});

test("projects attached to one server each get a database of their own", async () => {
  const app = await buildApp();
  try {
    const admin = await makeUser(app, 1);
    const first = await makeProject(app, admin.cookie, "First");
    const second = await makeProject(app, admin.cookie, "Second");
    const connectionId = await makeServer(app, admin.cookie, "db-links.internal.example");
    const link = (links: object[]) =>
      call(app, admin.cookie, "PUT", `/api/admin/connections/${connectionId}/projects`, { links });

    // Both on the connection's own database: the second deployment would drop the first's tables.
    const clash = await link([{ projectId: first }, { projectId: second }]);
    assert.equal(clash.statusCode, 409);
    assert.equal(clash.json().code, "CONNECTION_DATABASE_TAKEN");
    const sameName = await link([
      { projectId: first, database: "Shop" },
      { projectId: second, database: "shop" },
    ]);
    assert.equal(sameName.statusCode, 409);
    const invalid = await link([{ projectId: first, database: "shop; DROP DATABASE main" }]);
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().code, "CONNECTION_DATABASE_INVALID");
    // Refused whole: nothing was attached along the way.
    assert.equal(getProjectConnection(first, connectionId), null);

    const saved = await link([{ projectId: first }, { projectId: second, database: "shop" }]);
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(
      (saved.json() as { connection: { projects: { id: string; database?: string }[] } }).connection.projects
        .map((p) => [p.id, p.database ?? null])
        .sort(),
      [
        [first, null],
        [second, "shop"],
      ].sort(),
    );

    // What a deployment of each project connects to.
    assert.equal(getProjectConnection(first, connectionId)?.database, "main");
    assert.equal(getProjectConnection(second, connectionId)?.database, "shop");
    const listed = (await call(app, admin.cookie, "GET", `/api/projects/${second}/connections`)).json() as {
      connections: { database: string }[];
    };
    assert.equal(listed.connections[0].database, "shop");

    // The older body leaves the databases as they are.
    const legacy = await call(app, admin.cookie, "PUT", `/api/admin/connections/${connectionId}/projects`, {
      projectIds: [second],
    });
    assert.equal(legacy.statusCode, 200);
    assert.equal(getProjectConnection(second, connectionId)?.database, "shop");
    assert.equal(getProjectConnection(first, connectionId), null);
  } finally {
    await app.close();
  }
});

test("a project in the trash does not hold its database, and comes back detached once it was given away", async () => {
  const app = await buildApp();
  try {
    const admin = await makeUser(app, 1);
    const old = await makeProject(app, admin.cookie, "Old");
    const fresh = await makeProject(app, admin.cookie, "Fresh");
    const connectionId = await makeServer(app, admin.cookie, "db-trash.internal.example");
    const link = (links: object[]) =>
      call(app, admin.cookie, "PUT", `/api/admin/connections/${connectionId}/projects`, { links });
    const setStatus = (id: string, status: string) =>
      call(app, admin.cookie, "PATCH", `/api/projects/${id}`, { status });

    assert.equal((await link([{ projectId: old, database: "shop" }])).statusCode, 200);
    assert.equal((await setStatus(old, "trashed")).statusCode, 200);

    // The admin form sends the trashed project's link along with the new one.
    const given = await link([
      { projectId: old, database: "shop" },
      { projectId: fresh, database: "shop" },
    ]);
    assert.equal(given.statusCode, 200, given.body);
    const projects = (given.json() as { connection: { projects: { id: string; trashed?: boolean }[] } }).connection
      .projects;
    assert.equal(projects.find((p) => p.id === old)?.trashed, true);
    assert.equal(projects.find((p) => p.id === fresh)?.trashed, undefined);

    // Back from the trash: the database is someone else's now.
    assert.equal((await setStatus(old, "active")).statusCode, 200);
    assert.equal(getProjectConnection(old, connectionId), null);
    assert.equal(getProjectConnection(fresh, connectionId)?.database, "shop");

    // Nobody took it: the link survives the round trip.
    const kept = await makeProject(app, admin.cookie, "Kept");
    assert.equal(
      (
        await link([
          { projectId: fresh, database: "shop" },
          { projectId: kept, database: "kept" },
        ])
      ).statusCode,
      200,
    );
    await setStatus(kept, "trashed");
    await setStatus(kept, "active");
    assert.equal(getProjectConnection(kept, connectionId)?.database, "kept");
  } finally {
    await app.close();
  }
});

test("a watch imposed from a connection is on for its projects and closed to their administrators", async () => {
  const app = await buildApp();
  try {
    const admin = await makeUser(app, 1);
    const member = await makeUser(app);
    const projectId = await makeProject(app, member.cookie, "Watched");
    const connectionId = await makeServer(app, admin.cookie, "db-watch.internal.example");
    await call(app, admin.cookie, "PUT", `/api/admin/connections/${connectionId}/projects`, { links: [{ projectId }] });
    const settings = async () =>
      (await call(app, member.cookie, "GET", `/api/projects/${projectId}/monitoring`)).json().settings as {
        enabled: boolean;
        intervalMinutes: number;
        ignoreTables: string[];
        forced: { intervalMinutes: number; connections: string[] } | null;
      };
    const impose = (forcedMonitoring: object | null) =>
      call(app, admin.cookie, "PUT", `/api/admin/connections/${connectionId}`, { forcedMonitoring });
    const { listDueProjects } = await import("../monitoring/repository.js");

    assert.equal((await settings()).enabled, false);
    assert.equal(listDueProjects().includes(projectId), false);
    assert.equal((await impose({ intervalMinutes: 7 })).json().code, "MONITORING_INVALID");

    const imposed = await impose({ intervalMinutes: 15 });
    assert.equal(imposed.statusCode, 200, imposed.body);
    assert.deepEqual(imposed.json().connection.forcedMonitoring, { intervalMinutes: 15 });
    assert.deepEqual(await settings(), {
      enabled: true,
      intervalMinutes: 15,
      ignoreTables: [],
      lastCheckedAt: null,
      forced: { intervalMinutes: 15, connections: ["Server db-watch.internal.example"] },
    });
    assert.equal(listDueProjects().includes(projectId), true);

    // The project's administrator cannot switch it off, nor ignore its way out.
    const off = { enabled: false, intervalMinutes: 1440, ignoreTables: ["orders"] };
    const refused = await call(app, member.cookie, "PUT", `/api/projects/${projectId}/monitoring`, off);
    assert.equal(refused.statusCode, 403);
    assert.equal(refused.json().code, "MONITORING_LOCKED");

    // An instance administrator changes the ignored tables; on/off and the pace stay the connection's.
    assert.equal((await call(app, admin.cookie, "PUT", `/api/projects/${projectId}/monitoring`, off)).statusCode, 200);
    const after = await settings();
    assert.deepEqual([after.enabled, after.intervalMinutes, after.ignoreTables], [true, 15, ["orders"]]);

    // Let go: the project is back to what it had chosen, and to its own administrators.
    assert.equal((await impose(null)).statusCode, 200);
    const freed = await settings();
    assert.deepEqual([freed.enabled, freed.forced], [false, null]);
    assert.equal((await call(app, member.cookie, "PUT", `/api/projects/${projectId}/monitoring`, off)).statusCode, 200);
  } finally {
    await app.close();
  }
});

test("a member cannot reach a server an administrator manages through a connection of their own", async () => {
  const app = await buildApp();
  try {
    const admin = await makeUser(app, 1);
    const member = await makeUser(app);
    await makeServer(app, admin.cookie, "db-managed.internal.example");
    const projectId = await makeProject(app, member.cookie, "Mine");
    const target = { name: "Sneaky", engine: "postgres", port: 5432, database: "main", user: "deploy", password: "x" };

    const created = await call(app, member.cookie, "POST", `/api/projects/${projectId}/connections`, {
      ...target,
      host: "DB-Managed.internal.example",
    });
    assert.equal(created.statusCode, 403);
    assert.equal(created.json().code, "CONNECTION_TARGET_MANAGED");

    const byString = await call(app, member.cookie, "POST", `/api/projects/${projectId}/connections`, {
      name: "Sneaky",
      engine: "postgres",
      connectionString: "postgres://deploy:x@db-managed.internal.example/other",
    });
    assert.equal(byString.statusCode, 403);

    const tested = await call(app, member.cookie, "POST", `/api/projects/${projectId}/connections/test`, {
      ...target,
      host: "db-managed.internal.example",
    });
    assert.equal(tested.statusCode, 403);

    const fromDatabase = await call(app, member.cookie, "POST", "/api/projects/from-database", {
      ...target,
      host: "db-managed.internal.example",
      projectName: "Copied",
    });
    assert.equal(fromDatabase.statusCode, 403);

    // A server nobody manages is theirs to connect, and cannot be moved onto a managed one afterwards.
    const own = await call(app, member.cookie, "POST", `/api/projects/${projectId}/connections`, {
      ...target,
      host: "db-own.internal.example",
    });
    assert.equal(own.statusCode, 200, own.body);
    const ownId = (own.json() as { connection: { id: string } }).connection.id;
    const moved = await call(app, member.cookie, "PUT", `/api/projects/${projectId}/connections/${ownId}`, {
      host: "db-managed.internal.example",
    });
    assert.equal(moved.statusCode, 403);

    // The administrator is not held to it.
    const asAdmin = await call(app, admin.cookie, "POST", `/api/projects/${projectId}/connections`, {
      ...target,
      host: "db-managed.internal.example",
    });
    assert.equal(asAdmin.statusCode, 200, asAdmin.body);
  } finally {
    await app.close();
  }
});
