import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-seeds-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
process.env.ATHANORDB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms, getRoom } = await import("../../realtime/roomRegistry.js");
const { writeProjectToDoc } = await import("@athanordb/shared");

const HOST = "localhost:3001";
const ORIGIN = `http://${HOST}`;
type App = Awaited<ReturnType<typeof buildApp>>;

function headers(extra: Record<string, string> = {}) {
  return { host: HOST, origin: ORIGIN, ...extra };
}

async function userCookie(app: App, isAdmin: 0 | 1) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?, NULL)").run(
    randomUUID(),
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
  return `athanordb_sid=${res.cookies.find((c) => c.name === "athanordb_sid")!.value}`;
}

function call(app: App, cookie: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: headers({ cookie }),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

/** customers ← orders, on the live canvas. */
function seedCanvas(projectId: string) {
  const room = getRoom(projectId);
  room.doc.transact(() => {
    writeProjectToDoc(room.doc, {
      id: projectId,
      name: "Shop",
      tables: [
        {
          id: "t-customers",
          name: "customers",
          fields: [
            { id: "c-id", name: "id", type: "integer", pk: true },
            { id: "c-name", name: "name", type: "varchar(20)", notNull: true },
          ],
          indexes: [],
          position: { x: 0, y: 0 },
          detailLevel: "standard",
        },
        {
          id: "t-orders",
          name: "orders",
          fields: [
            { id: "o-id", name: "id", type: "integer", pk: true },
            { id: "o-customer", name: "customer_id", type: "integer" },
          ],
          indexes: [],
          position: { x: 300, y: 0 },
          detailLevel: "standard",
        },
      ],
      refs: [
        {
          id: "r1",
          from: { tableId: "t-orders", fieldId: "o-customer" },
          to: { tableId: "t-customers", fieldId: "c-id" },
          cardinality: "one-to-many",
        },
      ],
      enums: [],
      zones: [],
      stickyNotes: [],
      tableGroups: [],
    });
  }, "test-seed");
}

const csvOptions = (mapping: (string | null)[], mode = "if-empty") => ({ separator: ",", header: true, mapping, mode });

test("seeds: set and listed, validated before the deployment, inserted parents first, not twice", async () => {
  const app = await buildApp();
  try {
    const owner = await userCookie(app, 1);
    const project = (await call(app, owner, "POST", "/api/projects", { name: "Shop" })).json() as { id: string };
    seedCanvas(project.id);
    const targetFile = join(mkdtempSync(join(tmpdir(), "athanordb-seeds-")), "shop.sqlite");
    const connId = (
      await call(app, owner, "POST", `/api/projects/${project.id}/connections`, {
        name: "Shop db",
        engine: "sqlite",
        filePath: targetFile,
      })
    ).json().connection.id as string;
    const base = `/api/projects/${project.id}`;

    const invalid = await call(app, owner, "PUT", `${base}/seeds/t-customers`, {
      content: "id,name\n1,Ada",
      options: { ...csvOptions(["c-id", "c-name"]), separator: "#" },
    });
    assert.equal(invalid.json().code, "SEED_INVALID");

    // orders first: a child seed referring to a customer that does not exist (yet).
    const orders = await call(app, owner, "PUT", `${base}/seeds/t-orders`, {
      content: "id,customer_id\n10,1\n11,2\n12,3",
      options: csvOptions(["o-id", "o-customer"]),
    });
    assert.equal(orders.statusCode, 200, orders.body);
    await call(app, owner, "PUT", `${base}/seeds/t-customers`, {
      content: 'id,name\n1,Ada\n2,"Grace, the admiral"',
      options: csvOptions(["c-id", "c-name"]),
    });
    const listed = (await call(app, owner, "GET", `${base}/seeds`)).json().seeds as {
      tableName: string;
      rowCount: number;
    }[];
    assert.deepEqual(
      listed.map((s) => [s.tableName, s.rowCount]),
      [
        ["customers", 2],
        ["orders", 3],
      ],
    );

    // Order 12 points at customer 3, which no seed provides: the plan says so, the deployment refuses.
    const plan = (await call(app, owner, "POST", `${base}/connections/${connId}/plan-deployment`, {})).json() as {
      seeds: { tableName: string; rows: number; action: string; errors: number }[];
    };
    assert.deepEqual(
      plan.seeds.map((s) => [s.tableName, s.rows, s.action, s.errors]),
      [
        ["customers", 2, "insert", 0],
        ["orders", 3, "insert", 1],
      ],
      "parents first",
    );
    const refused = await call(app, owner, "POST", `${base}/connections/${connId}/apply-deployment`, {
      resolutions: {},
    });
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.json().code, "SEEDS_NOT_DEPLOYABLE");
    assert.deepEqual(refused.json().tables, ["orders"]);
    const untouched = new Database(targetFile, { readonly: true });
    const tablesAfterRefusal = untouched.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get() as {
      n: number;
    };
    untouched.close();
    assert.equal(tablesAfterRefusal.n, 0, "nothing ran: the DDL waits for the seeds too");

    await call(app, owner, "PUT", `${base}/seeds/t-orders`, {
      content: "id,customer_id\n10,1\n11,2\n12,",
      options: csvOptions(["o-id", "o-customer"]),
    });
    const deployed = await call(app, owner, "POST", `${base}/connections/${connId}/apply-deployment`, {
      resolutions: {},
    });
    assert.equal(deployed.statusCode, 200, deployed.body);
    assert.deepEqual(deployed.json().seedReport, [
      { tableName: "customers", inserted: 2, skipped: false },
      { tableName: "orders", inserted: 3, skipped: false },
    ]);
    const target = new Database(targetFile, { readonly: true });
    assert.deepEqual(target.prepare("SELECT id, name FROM customers ORDER BY id").all(), [
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace, the admiral" },
    ]);
    assert.equal(
      (target.prepare("SELECT customer_id FROM orders WHERE id = 12").get() as { customer_id: null }).customer_id,
      null,
    );
    target.close();

    // `if-empty`: a second deployment leaves the rows alone.
    const again = await call(app, owner, "POST", `${base}/connections/${connId}/apply-deployment`, { resolutions: {} });
    assert.deepEqual(
      (again.json().seedReport as { tableName: string; skipped: boolean }[]).map((r) => [r.tableName, r.skipped]),
      [
        ["customers", true],
        ["orders", true],
      ],
    );
    const history = (await call(app, owner, "GET", `${base}/connections/${connId}/history`)).json().history as {
      seedReport?: { inserted: number }[];
    }[];
    assert.equal(history[history.length - 1].seedReport?.[0].inserted, 2, "the first deployment's report is kept");
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("seeds: a full lock freezes the seed for those it binds; a view grant cannot set one", async () => {
  const app = await buildApp();
  try {
    const instanceAdmin = await userCookie(app, 1);
    const owner = await userCookie(app, 0);
    const viewer = await userCookie(app, 0);
    const project = (await call(app, owner, "POST", "/api/projects", { name: "Shop" })).json() as { id: string };
    seedCanvas(project.id);
    const base = `/api/projects/${project.id}`;
    const put = (cookie: string) =>
      call(app, cookie, "PUT", `${base}/seeds/t-customers`, {
        content: "id,name\n1,Ada",
        options: csvOptions(["c-id", "c-name"]),
      });

    assert.equal((await put(viewer)).statusCode, 403);
    assert.equal((await put(owner)).statusCode, 200);

    const locked = await call(app, instanceAdmin, "PUT", `${base}/locks/t-customers`, {
      level: "full",
      authority: "instance",
    });
    assert.equal(locked.statusCode, 200, locked.body);
    const refused = await put(owner);
    assert.equal(refused.json().code, "TABLE_LOCKED");
    assert.equal((await call(app, owner, "DELETE", `${base}/seeds/t-customers`)).json().code, "TABLE_LOCKED");
    assert.equal((await put(instanceAdmin)).statusCode, 200, "the lock's own authority still can");
  } finally {
    closeAllRooms();
    await app.close();
  }
});
