import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

await useTestDatabase("deploylevel");
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");

const HOST = "localhost:3001";
type App = Awaited<ReturnType<typeof buildApp>>;
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Level = "view" | "edit" | "deploy" | "administrator";
const LEVELS: Level[] = ["view", "edit", "deploy", "administrator"];
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `http://${HOST}`, ...extra });

async function login(app: App, isAdmin: 0 | 1 = 0) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  await db
    .prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?, NULL)")
    .run(id, email, await hashPassword(password), isAdmin);
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password },
  });
  return { id, email, cookie: `nebuladb_sid=${res.cookies.find((c) => c.name === "nebuladb_sid")!.value}` };
}

const call = (app: App, cookie: string, method: Method, url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: headers({ cookie }),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const bearer = (key: string) => headers({ authorization: `Bearer ${key}` });

/** A project with a schema and two SQLite databases, and one person at each level (given to the person, not a team). */
async function setup(app: App) {
  const owner = await login(app);
  const project = (await call(app, owner.cookie, "POST", "/api/projects", { name: "Shop" })).json() as { id: string };
  const base = `/api/projects/${project.id}`;
  await call(app, owner.cookie, "POST", `${base}/import`, { source: "Table customers {\n  id integer [pk]\n}\n" });

  const dir = mkdtempSync(join(tmpdir(), "nebuladb-deploylevel-"));
  const connect = async (name: string) =>
    (
      await call(app, owner.cookie, "POST", `${base}/connections`, {
        name,
        engine: "sqlite",
        filePath: join(dir, `${name}.sqlite`),
      })
    ).json().connection.id as string;
  const first = await connect("first");
  const second = await connect("second");

  const people = {} as Record<Level, Awaited<ReturnType<typeof login>>>;
  for (const level of LEVELS) {
    people[level] = await login(app);
    const granted = await call(app, owner.cookie, "PUT", `${base}/members/${people[level].id}`, { permission: level });
    assert.equal(granted.statusCode, 200, granted.body);
  }
  return { owner, project, base, dir, first, second, people };
}

test("the deploy level: everything edit allows, the deployment operations, and nothing that is the administrators' alone", async () => {
  const app = await buildApp();
  try {
    const { owner, project, base, dir, first, second, people } = await setup(app);

    // What the server answers each level for itself.
    for (const level of LEVELS) {
      const seen = (await call(app, people[level].cookie, "GET", base)).json() as { permission: string };
      assert.equal(seen.permission, level);
    }

    // One deployment by the owner, so that there is a history to read.
    const deployed = await call(app, owner.cookie, "POST", `${base}/connections/${first}/apply-deployment`, {});
    assert.equal(deployed.statusCode, 200, deployed.body);

    // Each operation with the lowest level that may run it. A refusal is a
    // 403; anything else means the guard let the caller through (a 404 for
    // the made-up ids below, a 400 for a body the route then rejects).
    const team = randomUUID();
    await db.prepare("INSERT INTO teams (id, name) VALUES (?, ?)").run(team, `team-${team}`);
    const operations: [string, Method, string, unknown, Level][] = [
      ["list connections", "GET", `${base}/connections`, undefined, "view"],
      ["read drift marks", "GET", `${base}/drift`, undefined, "view"],
      ["read the watch", "GET", `${base}/monitoring`, undefined, "view"],
      ["import a schema", "POST", `${base}/import`, { source: "Table customers {\n  id integer [pk]\n}\n" }, "edit"],
      ["plan", "POST", `${base}/connections/${second}/plan-deployment`, {}, "deploy"],
      ["deployment history", "GET", `${base}/connections/${first}/history`, undefined, "deploy"],
      ["rollback", "POST", `${base}/connections/${first}/history/${randomUUID()}/rollback`, {}, "deploy"],
      ["compare", "POST", `${base}/connections/compare`, { sourceId: first, targetId: second }, "deploy"],
      ["drift check", "POST", `${base}/connections/${first}/drift-check`, {}, "deploy"],
      ["pipeline", "GET", `${base}/pipeline`, undefined, "deploy"],
      ["check now", "POST", `${base}/monitoring/check`, {}, "deploy"],
      ["pull", "POST", `${base}/connections/${first}/pull`, {}, "administrator"],
      ["dismiss drift", "POST", `${base}/connections/${first}/drift/dismiss`, {}, "administrator"],
      [
        "test a connection",
        "POST",
        `${base}/connections/test`,
        { engine: "sqlite", filePath: join(dir, "x.sqlite") },
        "administrator",
      ],
      ["update a connection", "PUT", `${base}/connections/${second}`, { name: "second" }, "administrator"],
      ["watch settings", "PUT", `${base}/monitoring`, { enabled: false, intervalMinutes: 60 }, "administrator"],
      ["list people", "GET", `${base}/members`, undefined, "administrator"],
      ["grant a team", "PUT", `${base}/teams/${team}`, { permission: "view" }, "administrator"],
      ["revoke a team", "DELETE", `${base}/teams/${team}`, undefined, "administrator"],
      ["webhooks", "GET", `${base}/webhooks`, undefined, "administrator"],
      ["lint rules", "PUT", `${base}/lint`, {}, "administrator"],
      ["rename", "PATCH", base, { name: "Shop" }, "administrator"],
    ];
    for (const [name, method, url, payload, needs] of operations) {
      for (const level of LEVELS) {
        const res = await call(app, people[level].cookie, method, url, payload);
        const allowed = LEVELS.indexOf(level) >= LEVELS.indexOf(needs);
        assert.equal(res.statusCode !== 403, allowed, `${name} as ${level}: ${res.statusCode} ${res.body}`);
      }
    }

    // Locking a table is the administrators'; `deploy` is told so like `edit` is.
    // Through `/api/v1`, which takes the table's name.
    for (const level of LEVELS) {
      const lock = await call(app, people[level].cookie, "PUT", `/api/v1/projects/${project.id}/locks/customers`, {
        level: "structure",
      });
      assert.equal(lock.statusCode === 200, level === "administrator", `lock as ${level}: ${lock.body}`);
    }

    // Deploying itself, last: it changes the second database for good.
    for (const level of ["view", "edit"] as const) {
      const refused = await call(
        app,
        people[level].cookie,
        "POST",
        `${base}/connections/${second}/apply-deployment`,
        {},
      );
      assert.equal(refused.statusCode, 403, level);
    }
    const byDeployer = await call(
      app,
      people.deploy.cookie,
      "POST",
      `${base}/connections/${second}/apply-deployment`,
      {},
    );
    assert.equal(byDeployer.statusCode, 200, byDeployer.body);
    const history = (await call(app, people.deploy.cookie, "GET", `${base}/connections/${second}/history`)).json()
      .history as { id: string; executedByEmail: string }[];
    assert.equal(history.length, 1);
    assert.equal(history[0].executedByEmail, people.deploy.email);
    const rolledBack = await call(
      app,
      people.deploy.cookie,
      "POST",
      `${base}/connections/${second}/history/${history[0].id}/rollback`,
      {},
    );
    assert.equal(rolledBack.statusCode, 200, rolledBack.body);

    // The history timeline names deployments for those who may read the deployment history.
    const kinds = async (level: Level) =>
      ((await call(app, people[level].cookie, "GET", `${base}/history/markers`)).json() as { kind: string }[]).map(
        (marker) => marker.kind,
      );
    assert.ok((await kinds("deploy")).includes("deployment"));
    assert.ok(!(await kinds("edit")).includes("deployment"));

    // Skipping the stage order stays an instance administrator's, whatever the project level.
    const skip = await call(app, people.deploy.cookie, "POST", `${base}/connections/${second}/apply-deployment`, {
      skipStageOrder: true,
      skipReason: "because",
    });
    assert.equal(skip.statusCode, 403);
    assert.equal(skip.json().code, "ADMIN_REQUIRED");
  } finally {
    await closeAllRooms();
    await app.close();
  }
});

test("the deploy level is granted like the others, to a team or a person, and the highest grant wins", async () => {
  const app = await buildApp();
  try {
    const owner = await login(app);
    const member = await login(app);
    const project = (await call(app, owner.cookie, "POST", "/api/projects", { name: "Grants" })).json() as {
      id: string;
    };
    const base = `/api/projects/${project.id}`;
    const team = randomUUID();
    await db.prepare("INSERT INTO teams (id, name) VALUES (?, ?)").run(team, `team-${team}`);
    await db.prepare("INSERT INTO team_members (team_id, user_id) VALUES (?, ?)").run(team, member.id);

    const unknown = await call(app, owner.cookie, "PUT", `${base}/teams/${team}`, { permission: "deployer" });
    assert.equal(unknown.statusCode, 400);
    assert.equal(unknown.json().code, "PERMISSION_INVALID");

    const granted = await call(app, owner.cookie, "PUT", `${base}/teams/${team}`, { permission: "deploy" });
    assert.equal(granted.statusCode, 200, granted.body);
    assert.equal(granted.json().permission, "deploy");
    const permission = async () =>
      ((await call(app, member.cookie, "GET", base)).json() as { permission: string }).permission;
    assert.equal(await permission(), "deploy");

    // A lower grant to the person changes nothing; a higher one wins.
    await call(app, owner.cookie, "PUT", `${base}/members/${member.id}`, { permission: "edit" });
    assert.equal(await permission(), "deploy");
    await call(app, owner.cookie, "PUT", `${base}/members/${member.id}`, { permission: "administrator" });
    assert.equal(await permission(), "administrator");

    // Grants written before the level existed read as they did.
    await db
      .prepare("UPDATE project_members SET permission = 'edit' WHERE project_id = ? AND user_id = ?")
      .run(project.id, member.id);
    await db
      .prepare("UPDATE project_teams SET permission = 'view' WHERE project_id = ? AND team_id = ?")
      .run(project.id, team);
    assert.equal(await permission(), "edit");
    assert.equal((await call(app, member.cookie, "GET", `${base}/pipeline`)).statusCode, 403);
  } finally {
    await closeAllRooms();
    await app.close();
  }
});

test("a deployment is announced to the followers who may deploy, not to those who only edit", async () => {
  const app = await buildApp();
  try {
    const { owner, base, first, people } = await setup(app);
    for (const level of ["edit", "deploy"] as const) {
      const followed = await call(app, people[level].cookie, "PUT", `${base}/subscription`, { events: ["deployment"] });
      assert.equal(followed.statusCode, 200, followed.body);
    }
    const deployed = await call(app, owner.cookie, "POST", `${base}/connections/${first}/apply-deployment`, {});
    assert.equal(deployed.statusCode, 200, deployed.body);

    const told = async (level: Level) =>
      ((await call(app, people[level].cookie, "GET", "/api/notifications")).json() as { notifications: unknown[] })
        .notifications.length;
    assert.equal(await told("deploy"), 1);
    assert.equal(await told("edit"), 0);
  } finally {
    await closeAllRooms();
    await app.close();
  }
});

test("/api/v1: a key acts at its owner's level — deploy reaches the deployment routes, not the administrators'", async () => {
  const app = await buildApp();
  try {
    const { project, first, second, people } = await setup(app);
    const v1 = `/api/v1/projects/${project.id}`;
    const scopes = ["projects:read", "projects:write", "deployments:trigger", "connections:manage"];
    const keyOf = async (level: Level) =>
      (await call(app, people[level].cookie, "POST", "/api/keys", { name: `${level} key`, scopes })).json()
        .plaintextKey as string;
    const keys = { edit: await keyOf("edit"), deploy: await keyOf("deploy") };
    const v1call = (key: string, method: Method, url: string, payload?: object) =>
      app.inject({ method, url, headers: bearer(key), ...(payload ? { payload } : {}) });

    assert.equal((await v1call(keys.deploy, "GET", v1)).json().permission, "deploy");

    const operations: [Method, string, object | undefined][] = [
      ["POST", `${v1}/connections/${first}/deploy`, {}],
      ["GET", `${v1}/pipeline`, undefined],
      ["GET", `${v1}/connections/${first}/history`, undefined],
      ["POST", `${v1}/connections/compare`, { sourceId: first, targetId: second }],
      ["POST", `${v1}/monitoring/check`, {}],
      ["POST", `${v1}/connections/${first}/history/${randomUUID()}/rollback`, {}],
    ];
    for (const [method, url, payload] of operations) {
      const refused = await v1call(keys.edit, method, url, payload);
      assert.equal(refused.statusCode, 403, `${method} ${url} as edit`);
      assert.equal(refused.json().code, "FORBIDDEN");
      const allowed = await v1call(keys.deploy, method, url, payload);
      assert.notEqual(allowed.statusCode, 403, `${method} ${url} as deploy: ${allowed.body}`);
    }
    const history = (await v1call(keys.deploy, "GET", `${v1}/connections/${first}/history`)).json().history;
    assert.equal(history.length, 1, "the deployment above ran");

    // The scopes are all there: it is the level that refuses.
    const administratorsOnly: [Method, string, object | undefined][] = [
      ["POST", `${v1}/connections`, { name: "third", engine: "sqlite", database: ":memory:" }],
      ["POST", `${v1}/connections/${first}/pull`, {}],
      ["DELETE", `${v1}/connections/${second}`, undefined],
      ["PUT", `${v1}/monitoring`, { enabled: true, intervalMinutes: 60 }],
      ["GET", `${v1}/webhooks`, undefined],
      ["PATCH", v1, { name: "Renamed" }],
    ];
    for (const [method, url, payload] of administratorsOnly) {
      const refused = await v1call(keys.deploy, method, url, payload);
      assert.equal(refused.statusCode, 403, `${method} ${url} as deploy: ${refused.body}`);
      assert.equal(refused.json().code, "FORBIDDEN");
    }
    const grant = await v1call(keys.deploy, "PUT", `${v1}/iam/${randomUUID()}`, { permission: "deploy" });
    assert.equal(grant.statusCode, 403);
  } finally {
    await closeAllRooms();
    await app.close();
  }
});
