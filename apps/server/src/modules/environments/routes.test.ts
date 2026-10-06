import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

process.env.NEBULADB_DB_PATH = join(tmpdir(), `nebuladb-test-environments-${randomUUID()}.sqlite`);
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms, getRoom } = await import("../../realtime/roomRegistry.js");
const { writeProjectToDoc } = await import("@nebuladb/shared");

const HOST = "localhost:3001";
const ORIGIN = `http://${HOST}`;

type App = Awaited<ReturnType<typeof buildApp>>;

function headers(extra: Record<string, string> = {}) {
  return { host: HOST, origin: ORIGIN, ...extra };
}

async function loginAs(app: App, email: string, password: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password },
  });
  const sessionCookie = res.cookies.find((c) => c.name === "nebuladb_sid");
  return `nebuladb_sid=${sessionCookie!.value}`;
}

async function makeUser(isAdmin: 0 | 1 = 0) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?, NULL)").run(
    randomUUID(),
    email,
    await hashPassword(password),
    isAdmin,
  );
  return { email, password };
}

/** One table on the project's live canvas, so a deployment has something to do. */
function seedCanvasTable(projectId: string, projectName: string) {
  const room = getRoom(projectId);
  room.doc.transact(() => {
    writeProjectToDoc(room.doc, {
      id: projectId,
      name: projectName,
      tables: [
        {
          id: "t-widgets",
          name: "widgets",
          fields: [{ id: "t-widgets.id", name: "id", type: "integer", pk: true }],
          indexes: [],
          position: { x: 0, y: 0 },
          detailLevel: "standard",
        },
      ],
      refs: [],
      enums: [],
      zones: [],
      stickyNotes: [],
      tableGroups: [],
    });
  }, "test-seed");
}

function call(
  app: App,
  cookie: string,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: headers({ cookie }),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

interface Stage {
  id: string;
  name: string;
  production: boolean;
  position: number;
}

async function stages(app: App, cookie: string): Promise<Stage[]> {
  return (await call(app, cookie, "GET", "/api/environments")).json().environments as Stage[];
}

test("environments: everyone reads the chain, only an instance administrator shapes it; one production stage at most", async () => {
  const app = await buildApp();
  try {
    const admin = await makeUser(1);
    const member = await makeUser(0);
    const adminCookie = await loginAs(app, admin.email, admin.password);
    const memberCookie = await loginAs(app, member.email, member.password);

    // A fresh instance starts with DEV › Staging › Prod, Prod being production.
    assert.deepEqual(
      (await stages(app, memberCookie)).map((s) => [s.name, s.production]),
      [
        ["DEV", false],
        ["Staging", false],
        ["Prod", true],
      ],
    );

    assert.equal((await call(app, memberCookie, "POST", "/api/admin/environments", { name: "QA" })).statusCode, 403);
    const invalid = await call(app, adminCookie, "POST", "/api/admin/environments", { name: "  " });
    assert.equal(invalid.json().code, "ENVIRONMENT_INVALID");
    const taken = await call(app, adminCookie, "POST", "/api/admin/environments", { name: "staging" });
    assert.equal(taken.json().code, "ENVIRONMENT_NAME_TAKEN");

    const qa = (await call(app, adminCookie, "POST", "/api/admin/environments", { name: "QA", color: "violet" })).json()
      .environment as Stage;
    assert.equal(qa.position, 3, "appended at the end");

    // Reorder: QA between DEV and Staging. Every stage must be named, once.
    const [dev, staging, prod] = await stages(app, adminCookie);
    const partial = await call(app, adminCookie, "PUT", "/api/admin/environments/order", { ids: [dev.id, qa.id] });
    assert.equal(partial.json().code, "ENVIRONMENT_INVALID");
    const reordered = await call(app, adminCookie, "PUT", "/api/admin/environments/order", {
      ids: [dev.id, qa.id, staging.id, prod.id],
    });
    assert.deepEqual(
      (reordered.json().environments as Stage[]).map((s) => s.name),
      ["DEV", "QA", "Staging", "Prod"],
    );

    // Flagging another stage moves the production flag rather than adding one.
    await call(app, adminCookie, "PATCH", `/api/admin/environments/${staging.id}`, { production: true });
    assert.deepEqual(
      (await stages(app, adminCookie)).filter((s) => s.production).map((s) => s.name),
      ["Staging"],
    );

    const actions = (
      db.prepare("SELECT action FROM audit_log WHERE action LIKE 'environment.%' ORDER BY rowid").all() as {
        action: string;
      }[]
    ).map((row) => row.action);
    assert.deepEqual(actions, ["environment.create", "environment.reorder", "environment.update"]);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("environments: a connection points at a stage, follows its renames, and loses it (not itself) when it goes", async () => {
  const app = await buildApp();
  try {
    const admin = await makeUser(1);
    const cookie = await loginAs(app, admin.email, admin.password);
    // The previous test reshaped the chain: start this one from a known one.
    for (const stage of await stages(app, cookie))
      await call(app, cookie, "DELETE", `/api/admin/environments/${stage.id}`);
    for (const name of ["DEV", "Staging"])
      await call(app, cookie, "POST", "/api/admin/environments", { name, color: "amber" });
    const project = (await call(app, cookie, "POST", "/api/projects", { name: "Shop" })).json() as { id: string };
    const staging = (await stages(app, cookie)).find((s) => s.name === "Staging")!;

    const unknown = await call(app, cookie, "POST", `/api/projects/${project.id}/connections`, {
      name: "Local",
      engine: "sqlite",
      database: ":memory:",
      environment: "Recette",
    });
    assert.equal(unknown.statusCode, 404, "a free-text label is no longer accepted");
    assert.equal(unknown.json().code, "ENVIRONMENT_NOT_FOUND");
    assert.deepEqual(unknown.json().known, ["DEV", "Staging"]);

    const byName = await call(app, cookie, "POST", `/api/projects/${project.id}/connections`, {
      name: "By name",
      engine: "sqlite",
      database: ":memory:",
      environment: " staging ",
    });
    assert.equal(byName.json().connection.environmentId, staging.id, "an existing stage's name still resolves");

    const created = await call(app, cookie, "POST", `/api/projects/${project.id}/connections`, {
      name: "Local",
      engine: "sqlite",
      database: ":memory:",
      environmentId: staging.id,
    });
    assert.equal(created.statusCode, 200, created.body);
    const connId = created.json().connection.id as string;
    assert.equal(created.json().connection.environment, "Staging");
    assert.equal(created.json().connection.environmentColor, "amber");
    assert.equal(created.json().connection.production, false);

    await call(app, cookie, "PATCH", `/api/admin/environments/${staging.id}`, { name: "Recette" });
    const listed = (await call(app, cookie, "GET", `/api/projects/${project.id}/connections`)).json().connections as {
      id: string;
      environment?: string;
    }[];
    assert.equal(listed.find((c) => c.id === connId)?.environment, "Recette");
    assert.equal(
      (db.prepare("SELECT environment FROM db_connections WHERE id = ?").get(connId) as { environment: string })
        .environment,
      "Recette",
      "the stored name that history and webhooks read follows the rename",
    );

    // Clearing the stage from a connection.
    const cleared = await call(app, cookie, "PUT", `/api/projects/${project.id}/connections/${connId}`, {
      environmentId: null,
    });
    assert.equal(cleared.json().connection.environmentId, undefined);
    await call(app, cookie, "PUT", `/api/projects/${project.id}/connections/${connId}`, { environmentId: staging.id });

    assert.equal((await call(app, cookie, "DELETE", `/api/admin/environments/${staging.id}`)).statusCode, 200);
    assert.deepEqual(db.prepare("SELECT environment, environment_id FROM db_connections WHERE id = ?").get(connId), {
      environment: null,
      environment_id: null,
    });
    assert.deepEqual(
      (await stages(app, cookie)).map((s) => [s.name, s.position]),
      [["DEV", 0]],
    );
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("environments: deploying to the production stage needs the connection's name, typed", async () => {
  const app = await buildApp();
  try {
    const admin = await makeUser(1);
    const cookie = await loginAs(app, admin.email, admin.password);
    const prod = (
      await call(app, cookie, "POST", "/api/admin/environments", { name: "Live", color: "red", production: true })
    ).json().environment as Stage;
    const project = (await call(app, cookie, "POST", "/api/projects", { name: "Shop" })).json() as {
      id: string;
      name: string;
    };
    seedCanvasTable(project.id, project.name);
    const targetFile = join(mkdtempSync(join(tmpdir(), "nebuladb-env-")), "prod.sqlite");
    const created = await call(app, cookie, "POST", `/api/projects/${project.id}/connections`, {
      name: "Shop live",
      engine: "sqlite",
      filePath: targetFile,
      environmentId: prod.id,
    });
    assert.equal(created.json().connection.production, true);
    const connId = created.json().connection.id as string;
    const deploy = (payload: unknown) =>
      call(app, cookie, "POST", `/api/projects/${project.id}/connections/${connId}/apply-deployment`, payload);

    const missing = await deploy({ resolutions: {} });
    assert.equal(missing.statusCode, 409);
    assert.equal(missing.json().code, "PRODUCTION_CONFIRMATION_REQUIRED");
    assert.equal(missing.json().environment, "Live");
    assert.equal(
      (await deploy({ resolutions: {}, confirmName: "Shop" })).json().code,
      "PRODUCTION_CONFIRMATION_REQUIRED",
    );

    const confirmed = await deploy({ resolutions: {}, confirmName: " Shop live " });
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    assert.equal(confirmed.json().success, true);

    // Rolling back is a write to production too.
    const history = (await call(app, cookie, "GET", `/api/projects/${project.id}/connections/${connId}/history`)).json()
      .history as { id: string }[];
    const rollback = (payload: unknown) =>
      call(
        app,
        cookie,
        "POST",
        `/api/projects/${project.id}/connections/${connId}/history/${history[0].id}/rollback`,
        payload,
      );
    assert.equal((await rollback({})).json().code, "PRODUCTION_CONFIRMATION_REQUIRED");
    assert.equal((await rollback({ confirmName: "Shop live" })).statusCode, 200);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("variables: one schema deployed under each stage's names; an undefined variable stops everything", async () => {
  const app = await buildApp();
  try {
    const admin = await makeUser(1);
    const cookie = await loginAs(app, admin.email, admin.password);
    const stage = async (body: unknown) => call(app, cookie, "POST", "/api/admin/environments", body);

    assert.equal((await stage({ name: "Vars bad", variables: { table_prefix: 'x"; DROP' } })).statusCode, 400);
    assert.equal((await stage({ name: "Vars bad", variables: { "not a name": "x" } })).statusCode, 400);
    const dev = (await stage({ name: "Vars dev", variables: { table_prefix: "dev_" } })).json().environment as Stage & {
      variables: Record<string, string>;
    };
    assert.deepEqual(dev.variables, { table_prefix: "dev_" });
    const staging = (await stage({ name: "Vars staging" })).json().environment as Stage;

    const project = (await call(app, cookie, "POST", "/api/projects", { name: "Shop" })).json() as { id: string };
    const base = `/api/projects/${project.id}`;
    const imported = await call(app, cookie, "POST", `${base}/import`, {
      source:
        'Table "{{table_prefix}}orders" {\n  id integer [pk]\n  label varchar(40)\n}\n\nTable settings {\n  id integer [pk]\n}\n',
    });
    assert.equal(imported.statusCode, 200, imported.body);
    const content = (await call(app, cookie, "GET", `${base}/content`)).json() as {
      tables: { id: string; name: string; fields: { id: string; name: string }[] }[];
    };
    const ordersTable = content.tables.find((table) => table.name === "{{table_prefix}}orders")!;
    const ordersId = ordersTable.id;
    // A seed follows its table to whatever the stage calls it.
    const seeded = await call(app, cookie, "PUT", `${base}/seeds/${ordersId}`, {
      content: "id,label\n1,first",
      options: { separator: ",", header: true, mapping: ordersTable.fields.map((field) => field.id), mode: "if-empty" },
    });
    assert.equal(seeded.statusCode, 200, seeded.body);

    const dir = mkdtempSync(join(tmpdir(), "nebuladb-vars-"));
    const connect = async (name: string, environmentId: string | null) =>
      (
        await call(app, cookie, "POST", `${base}/connections`, {
          name,
          engine: "sqlite",
          filePath: join(dir, `${name}.sqlite`),
          environmentId,
        })
      ).json().connection.id as string;
    const tablesOf = (name: string) => {
      const handle = new Database(join(dir, `${name}.sqlite`), { readonly: true });
      try {
        return (
          handle.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
            name: string;
          }[]
        ).map((row) => row.name);
      } finally {
        handle.close();
      }
    };
    const plan = (connId: string) => call(app, cookie, "POST", `${base}/connections/${connId}/plan-deployment`, {});
    const deploy = (connId: string) =>
      call(app, cookie, "POST", `${base}/connections/${connId}/apply-deployment`, { resolutions: {} });

    // Dev: the placeholder becomes the stage's prefix, in the plan and in the database.
    const devConn = await connect("dev", dev.id);
    const devPlan = await plan(devConn);
    assert.equal(devPlan.statusCode, 200, devPlan.body);
    assert.deepEqual((devPlan.json().diff.tables as { name: string }[]).map((table) => table.name).sort(), [
      "dev_orders",
      "settings",
    ]);
    assert.ok(!devPlan.json().sqlPreview.includes("{{"), devPlan.json().sqlPreview);
    assert.equal((await deploy(devConn)).statusCode, 200);
    assert.deepEqual(tablesOf("dev"), ["dev_orders", "settings"]);
    const devRows = new Database(join(dir, "dev.sqlite"), { readonly: true });
    assert.deepEqual(devRows.prepare("SELECT id, label FROM dev_orders").all(), [{ id: 1, label: "first" }]);
    devRows.close();
    // Deployed means level: nothing left to plan, no drift against the schema.
    assert.deepEqual((await plan(devConn)).json().diff.tables, []);
    const drift = await call(app, cookie, "POST", `${base}/connections/${devConn}/drift-check`, {});
    assert.deepEqual(drift.json().againstSchema, { tables: 0, refs: 0 });

    // Staging defines nothing: refused before anything is created — and so is a connection without a stage.
    const stagingConn = await connect("staging", staging.id);
    for (const attempt of [
      await plan(stagingConn),
      await deploy(stagingConn),
      await deploy(await connect("loose", null)),
    ]) {
      assert.equal(attempt.statusCode, 409, attempt.body);
      assert.equal(attempt.json().code, "VARIABLES_UNRESOLVED");
      assert.deepEqual(attempt.json().missing, ["table_prefix"]);
    }
    // An empty value is a value: no prefix on this stage.
    const patched = await call(app, cookie, "PATCH", `/api/admin/environments/${staging.id}`, {
      variables: { table_prefix: "" },
    });
    assert.equal(patched.statusCode, 200, patched.body);
    assert.equal((await deploy(stagingConn)).statusCode, 200);
    assert.deepEqual(tablesOf("staging"), ["orders", "settings"]);

    // Pulling from one stage does not turn the shared schema into that stage's.
    const devDb = new Database(join(dir, "dev.sqlite"));
    devDb.exec("ALTER TABLE dev_orders ADD COLUMN note TEXT");
    devDb.close();
    const pulled = await call(app, cookie, "POST", `${base}/connections/${devConn}/pull`, {});
    assert.equal(pulled.statusCode, 200, pulled.body);
    const after = (await call(app, cookie, "GET", `${base}/content`)).json() as {
      tables: { id: string; name: string; fields: { name: string }[] }[];
    };
    const orders = after.tables.find((table) => table.id === ordersId)!;
    assert.equal(orders.name, "{{table_prefix}}orders");
    assert.ok(orders.fields.some((field) => field.name === "note"));
  } finally {
    closeAllRooms();
    await app.close();
  }
});
