import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

await useTestDatabase("seed_files");
const seedDir = mkdtempSync(join(tmpdir(), "nebuladb-seed-files-"));
const importDir = mkdtempSync(join(tmpdir(), "nebuladb-seed-import-"));
process.env.NEBULADB_SEED_DIR = seedDir;
process.env.NEBULADB_SEED_IMPORT_DIR = importDir;
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

const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: ORIGIN, ...extra });

async function userCookie(app: App, isAdmin: 0 | 1) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  await db
    .prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?, NULL)")
    .run(randomUUID(), email, await hashPassword(password), isAdmin);
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password },
  });
  return `nebuladb_sid=${res.cookies.find((c) => c.name === "nebuladb_sid")!.value}`;
}

function call(app: App, cookie: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: headers({ cookie }),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

/** The CSV as a raw stream with the options in a header: the way the web app sends a big seed. */
function putFile(app: App, cookie: string, url: string, csv: string, options?: unknown) {
  return app.inject({
    method: "PUT",
    url,
    headers: headers({
      cookie,
      "content-type": "text/csv",
      ...(options ? { "x-seed-options": encodeURIComponent(JSON.stringify(options)) } : {}),
    }),
    payload: csv,
  });
}

/** customers <- orders, on the live canvas. */
async function seedCanvas(projectId: string) {
  const room = await getRoom(projectId);
  await room.write(() => {
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

test("seeds: a CSV past 2 MB is kept as a file, checked as it arrives, and deployed as a stream", async () => {
  const app = await buildApp();
  try {
    const owner = await userCookie(app, 1);
    const project = (await call(app, owner, "POST", "/api/projects", { name: "Shop" })).json() as { id: string };
    await seedCanvas(project.id);
    const base = `/api/projects/${project.id}`;
    const ROWS = 150_000;
    const lines = ["id,name"];
    for (let i = 1; i <= ROWS; i++) lines.push(`${i},Customer ${i}`);
    const big = lines.join("\n");
    assert.ok(big.length > 2_000_000, "bigger than a small seed may be");

    // Over the JSON route the limit still holds.
    const refused = await call(app, owner, "PUT", `${base}/seeds/t-customers`, {
      content: big,
      options: csvOptions(["c-id", "c-name"]),
    });
    assert.ok(refused.statusCode >= 400);

    // As a file it goes in, and the columns are matched from the header.
    const stored = await putFile(app, owner, `${base}/seeds/t-customers/file`, big);
    assert.equal(stored.statusCode, 200, stored.body);
    const body = stored.json() as {
      seed: { storage: string; rowCount: number; options: { mapping: string[] } };
      total: number;
    };
    assert.equal(body.seed.storage, "file");
    assert.equal(body.seed.rowCount, ROWS);
    assert.deepEqual(body.seed.options.mapping, ["c-id", "c-name"]);
    assert.equal(body.total, 0);
    assert.ok(existsSync(join(seedDir, project.id, "t-customers.csv")));

    // Listed as a file, never sent whole; a look at its first rows is.
    const listed = (await call(app, owner, "GET", `${base}/seeds`)).json().seeds as {
      tableName: string;
      storage: string;
      fileName?: string;
    }[];
    assert.deepEqual(
      listed.map((s) => [s.tableName, s.storage, s.fileName]),
      [["customers", "file", undefined]],
    );
    const one = (await call(app, owner, "GET", `${base}/seeds/t-customers`)).json().seed as {
      content: string;
      fileName?: string;
    };
    assert.equal(one.content, "");
    assert.equal(one.fileName, undefined);
    const preview = (await call(app, owner, "GET", `${base}/seeds/t-customers/preview?rows=3`)).json()
      .rows as string[][];
    assert.deepEqual(preview, [
      ["id", "name"],
      ["1", "Customer 1"],
      ["2", "Customer 2"],
      ["3", "Customer 3"],
    ]);

    // A child seed, small, pointing into the big one: its foreign keys are checked against the streamed keys.
    await call(app, owner, "PUT", `${base}/seeds/t-orders`, {
      content: `id,customer_id\n1,1\n2,${ROWS}\n3,${ROWS + 1}`,
      options: csvOptions(["o-id", "o-customer"]),
    });
    const targetFile = join(mkdtempSync(join(tmpdir(), "nebuladb-seed-files-target-")), "shop.sqlite");
    const connId = (
      await call(app, owner, "POST", `${base}/connections`, { name: "Shop db", engine: "sqlite", filePath: targetFile })
    ).json().connection.id as string;
    const plan = (await call(app, owner, "POST", `${base}/connections/${connId}/plan-deployment`, {})).json() as {
      seeds: { tableName: string; rows: number; errors: number }[];
    };
    assert.deepEqual(
      plan.seeds.map((s) => [s.tableName, s.rows, s.errors]),
      [
        ["customers", ROWS, 0],
        ["orders", 3, 1],
      ],
    );

    await call(app, owner, "PUT", `${base}/seeds/t-orders`, {
      content: `id,customer_id\n1,1\n2,${ROWS}`,
      options: csvOptions(["o-id", "o-customer"]),
    });
    const deployed = await call(app, owner, "POST", `${base}/connections/${connId}/apply-deployment`, {
      resolutions: {},
    });
    assert.equal(deployed.statusCode, 200, deployed.body);
    assert.deepEqual(deployed.json().seedReport, [
      { tableName: "customers", inserted: ROWS, skipped: false },
      { tableName: "orders", inserted: 2, skipped: false },
    ]);
    const target = new Database(targetFile, { readonly: true });
    assert.equal((target.prepare("SELECT COUNT(*) AS n FROM customers").get() as { n: number }).n, ROWS);
    assert.equal(
      (target.prepare("SELECT name FROM customers WHERE id = ?").get(ROWS) as { name: string }).name,
      `Customer ${ROWS}`,
    );
    target.close();

    // A small seed put over it takes its place and the file goes.
    await call(app, owner, "PUT", `${base}/seeds/t-customers`, {
      content: "id,name\n1,Ada",
      options: csvOptions(["c-id", "c-name"]),
    });
    assert.equal(existsSync(join(seedDir, project.id, "t-customers.csv")), false);
  } finally {
    await closeAllRooms();
    await app.close();
  }
});

test("seeds: a file's own check finds a duplicate key and a value longer than its column", async () => {
  const app = await buildApp();
  try {
    const owner = await userCookie(app, 1);
    const project = (await call(app, owner, "POST", "/api/projects", { name: "Shop" })).json() as { id: string };
    await seedCanvas(project.id);
    const base = `/api/projects/${project.id}`;
    const csv = "id,name\n1,Ada\n2,Grace\n2,Edsger\n3,A name that is much too long for it";
    const stored = await putFile(app, owner, `${base}/seeds/t-customers/file`, csv, csvOptions(["c-id", "c-name"]));
    assert.equal(stored.statusCode, 200, stored.body);
    const body = stored.json() as {
      issues: { kind: string; row: number }[];
      seed: { overflows: { column: string; limit: number }[] };
    };
    assert.deepEqual(
      body.issues.map((i) => [i.kind, i.row]),
      [
        ["unique", 3],
        ["length", 4],
      ],
    );
    assert.deepEqual(
      body.seed.overflows.map((o) => [o.column, o.limit]),
      [["name", 20]],
    );

    // A mapping that does not fit the file is refused and leaves nothing behind.
    const wrong = await putFile(app, owner, `${base}/seeds/t-orders/file`, "id,customer_id\n1,1", csvOptions(["o-id"]));
    assert.equal(wrong.statusCode, 400);
    assert.equal(existsSync(join(seedDir, project.id, "t-orders.csv")), false);
  } finally {
    await closeAllRooms();
    await app.close();
  }
});

test("seeds: an administrator imports files from the import folder, one by path or a whole folder, and only from there", async () => {
  const app = await buildApp();
  try {
    const admin = await userCookie(app, 1);
    const owner = await userCookie(app, 0);
    const project = (await call(app, admin, "POST", "/api/projects", { name: "Shop" })).json() as { id: string };
    await seedCanvas(project.id);
    const base = `/api/projects/${project.id}`;
    mkdirSync(join(importDir, "run1"));
    writeFileSync(join(importDir, "run1", "customers.csv"), "id;name\n1;Ada\n2;Grace\n");
    writeFileSync(join(importDir, "run1", "Orders.csv"), "id,customer_id\n10,1\n11,2\n");
    writeFileSync(join(importDir, "run1", "ghost.csv"), "id\n1\n");

    const one = await call(app, admin, "POST", `${base}/seeds/t-customers/from-path`, { path: "run1/customers.csv" });
    assert.equal(one.statusCode, 200, one.body);
    assert.equal(one.json().seed.options.separator, ";", "the separator is read from the first line");
    assert.equal(one.json().seed.rowCount, 2);

    const folder = await call(app, admin, "POST", `${base}/seeds/import-folder`, { path: "run1" });
    assert.equal(folder.statusCode, 200, folder.body);
    assert.deepEqual(
      (folder.json().results as { file: string; table: string | null; status: string; rows?: number }[]).map((r) => [
        r.file,
        r.table,
        r.status,
        r.rows,
      ]),
      [
        ["Orders.csv", "orders", "imported", 2],
        ["customers.csv", "customers", "imported", 2],
        ["ghost.csv", null, "no-table", undefined],
      ],
    );

    // Outside the folder, or not an administrator: refused.
    writeFileSync(join(tmpdir(), "nebuladb-outside.csv"), "id\n1\n");
    const outside = await call(app, admin, "POST", `${base}/seeds/t-customers/from-path`, {
      path: "../nebuladb-outside.csv",
    });
    assert.equal(outside.json().code, "SEED_IMPORT_UNAVAILABLE");
    const absolute = await call(app, admin, "POST", `${base}/seeds/t-customers/from-path`, {
      path: join(tmpdir(), "nebuladb-outside.csv"),
    });
    assert.equal(absolute.json().code, "SEED_IMPORT_UNAVAILABLE");
    const notAdmin = await call(app, owner, "POST", `${base}/seeds/t-customers/from-path`, {
      path: "run1/customers.csv",
    });
    assert.equal(notAdmin.statusCode, 403);
  } finally {
    await closeAllRooms();
    await app.close();
  }
});
