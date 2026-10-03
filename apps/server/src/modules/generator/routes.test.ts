import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-generator-${randomUUID()}.sqlite`);
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

async function userCookie(app: App) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, 0, NULL)").run(
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

function call(app: App, cookie: string, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: headers({ cookie }),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

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
          fields: [{ id: "c-id", name: "id", type: "integer", pk: true }],
          indexes: [],
          position: { x: 0, y: 0 },
          detailLevel: "standard",
        },
        {
          id: "t-orders",
          name: "orders",
          fields: [
            { id: "o-id", name: "id", type: "serial", pk: true, increment: true },
            { id: "o-customer", name: "customer_id", type: "integer", notNull: true },
            { id: "o-status", name: "status", type: "varchar(10)", notNull: true },
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

test("generator: settings kept, rows generated from the schema and the parents' seeds, ready to save as a seed", async () => {
  const app = await buildApp();
  try {
    const owner = await userCookie(app);
    const project = (await call(app, owner, "POST", "/api/projects", { name: "Shop" })).json() as { id: string };
    seedCanvas(project.id);
    const base = `/api/projects/${project.id}`;
    const config = {
      rows: 30,
      seed: 42,
      locale: "fr",
      columns: { "o-status": { kind: "oneOf", values: ["new", "paid", "sent"], weights: [1, 2, 1] } },
    };

    const invalid = await call(app, owner, "PUT", `${base}/generators/t-orders`, { ...config, rows: 0 });
    assert.equal(invalid.json().code, "GENERATOR_INVALID");
    const unknownKind = await call(app, owner, "PUT", `${base}/generators/t-orders`, {
      ...config,
      columns: { "o-status": { kind: "lorem" } },
    });
    assert.equal(unknownKind.json().code, "GENERATOR_INVALID");
    assert.equal((await call(app, owner, "PUT", `${base}/generators/t-orders`, config)).statusCode, 200);
    assert.deepEqual((await call(app, owner, "GET", `${base}/generators/t-orders`)).json().config, config);

    // No customers yet: a NOT NULL foreign key cannot be filled, and says so.
    const orphan = (await call(app, owner, "POST", `${base}/generators/t-orders/run`, {})).json();
    assert.deepEqual(orphan.problems, [{ column: "customer_id", reason: "no-parent-values" }]);

    // Give customers a seed: orders draw their customer from it.
    await call(app, owner, "PUT", `${base}/seeds/t-customers`, {
      content: "id\n1\n2\n3",
      options: { separator: ",", header: true, mapping: ["c-id"], mode: "if-empty" },
    });
    const run = await call(app, owner, "POST", `${base}/generators/t-orders/run`, {});
    assert.equal(run.statusCode, 200, run.body);
    const body = run.json() as {
      provider: string;
      columns: { fieldId: string; name: string }[];
      csv: string;
      rowCount: number;
      problems: unknown[];
    };
    assert.equal(body.provider, "builtin");
    assert.deepEqual(
      body.columns.map((c) => c.name),
      ["customer_id", "status"],
      "the serial id is the database's",
    );
    assert.equal(body.rowCount, 30);
    assert.deepEqual(body.problems, []);
    const lines = body.csv.trim().split("\n").slice(1);
    assert.ok(
      lines.every((line) => /^[123],(new|paid|sent)$/.test(line)),
      body.csv,
    );
    const again = (await call(app, owner, "POST", `${base}/generators/t-orders/run`, {})).json() as { csv: string };
    assert.equal(again.csv, body.csv, "same settings, same rows");

    // Saved as the table's seed, it passes the same checks as any file.
    const saved = await call(app, owner, "PUT", `${base}/seeds/t-orders`, {
      content: body.csv,
      options: { separator: ",", header: true, mapping: body.columns.map((c) => c.fieldId), mode: "if-empty" },
    });
    assert.equal(saved.statusCode, 200, saved.body);

    const unknownProvider = await call(app, owner, "POST", `${base}/generators/t-orders/run`, { provider: "ai:x" });
    assert.equal(unknownProvider.json().code, "GENERATOR_INVALID");
  } finally {
    closeAllRooms();
    await app.close();
  }
});
