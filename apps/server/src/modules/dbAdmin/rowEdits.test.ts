import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { DbAdminTableDescription } from "@nebuladb/shared";

// Same rationale as `app.test.ts`: env vars must land before anything
// transitively imports `db.ts`/`shared/crypto.ts`.
process.env.NEBULADB_DB_PATH = join(tmpdir(), `nebuladb-test-rowedits-${randomUUID()}.sqlite`);
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");
const { resetConnectionBudgets } = await import("../connections/connectionBudget.js");
const { describeRowEditing, planRowEdits, MAX_ROW_OPERATIONS } = await import("./rowEdits.js");

type App = Awaited<ReturnType<typeof buildApp>>;
type Method = "GET" | "POST" | "PUT";

const HOST = "localhost:3001";
const PASSWORD = "correct horse battery staple";
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `http://${HOST}`, ...extra });

async function makeUser(app: App, isAdmin: 0 | 1 = 0) {
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, ?, NULL)").run(
    id,
    email,
    await hashPassword(PASSWORD),
    isAdmin,
  );
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password: PASSWORD },
  });
  return { id, cookie: `nebuladb_sid=${res.cookies.find((c) => c.name === "nebuladb_sid")!.value}` };
}

function call(app: App, cookie: string, method: Method, url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: headers(cookie ? { cookie } : {}),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

/** A real SQLite file: the one engine the console can be tested against without a server. */
function seedTarget(): string {
  const file = join(tmpdir(), `nebuladb-test-rowedits-target-${randomUUID()}.sqlite`);
  const target = new Database(file);
  target.exec(`
    CREATE TABLE people (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      note TEXT,
      score INTEGER,
      price DECIMAL(20, 4),
      active BOOLEAN DEFAULT 1,
      photo BLOB,
      shout TEXT GENERATED ALWAYS AS (upper(name)) VIRTUAL,
      created TEXT DEFAULT 'now'
    );
    INSERT INTO people (id, name, note, score, price) VALUES
      (1, 'Ada', 'first', 9007199254740993, '12.5000'),
      (2, 'Linus', NULL, 2, NULL),
      (9007199254740995, 'Grace', '', 3, NULL);
    CREATE TABLE loose (a TEXT, b TEXT);
    INSERT INTO loose VALUES ('x', 'y');
    CREATE VIEW people_view AS SELECT id, name FROM people;
    CREATE TABLE "we""ird ta.ble" ("k""ey" TEXT PRIMARY KEY, "o'clock" TEXT, "semi;colon" INTEGER);
    INSERT INTO "we""ird ta.ble" VALUES ('a"b', 'it''s', 1);
    CREATE TABLE ignored (id INTEGER PRIMARY KEY, v TEXT);
    INSERT INTO ignored VALUES (1, 'kept');
    CREATE TRIGGER ignore_updates BEFORE UPDATE ON ignored BEGIN SELECT RAISE(IGNORE); END;
  `);
  target.close();
  return file;
}

function peek<T>(file: string, sql: string, ...params: unknown[]): T {
  const target = new Database(file, { readonly: true });
  try {
    return target
      .prepare(sql)
      .safeIntegers(true)
      .get(...params) as T;
  } finally {
    target.close();
  }
}

async function sqliteConnection(app: App, cookie: string, extra: Record<string, unknown> = {}) {
  const res = await call(app, cookie, "POST", "/api/admin/connections", {
    name: `Target ${randomUUID().slice(0, 6)}`,
    engine: "sqlite",
    filePath: seedTarget(),
    ...extra,
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json().connection as { id: string; filePath: string };
}

const rows = (app: App, cookie: string, base: string, table: string) =>
  call(app, cookie, "GET", `${base}/editable-rows?table=${encodeURIComponent(table)}`);

const edit = (app: App, cookie: string, base: string, body: Record<string, unknown>) =>
  call(app, cookie, "POST", `${base}/row-edits`, { table: "people", ...body });

async function withApp(fn: (app: App) => Promise<void>) {
  const app = await buildApp();
  try {
    resetConnectionBudgets();
    await fn(app);
  } finally {
    closeAllRooms();
    await app.close();
  }
}

const ADA_RENAME = {
  type: "update",
  key: { id: "1" },
  original: { name: "Ada" },
  values: { name: "Ada L." },
};

test("rows: the grid reads text cells by key order, and says what may be edited", async () => {
  await withApp(async (app) => {
    const admin = await makeUser(app, 1);
    const { id } = await sqliteConnection(app, admin.cookie);
    const base = `/api/admin/connections/${id}`;

    const res = await rows(app, admin.cookie, base, "people");
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.editing.editable, true);
    assert.deepEqual(body.editing.key, ["id"]);
    const column = (name: string) => body.editing.columns.find((c: { name: string }) => c.name === name);
    assert.deepEqual([column("id").kind, column("id").hasDefault], ["integer", true]);
    assert.deepEqual([column("price").kind, column("active").kind], ["decimal", "boolean"]);
    assert.deepEqual(column("active").booleanValues, ["1", "0"]);
    assert.equal(column("photo").readOnly, "binary");
    assert.equal(column("shout").readOnly, "generated");
    assert.equal(column("created").hasDefault, true);
    // Big integers keep every digit; NULL and the empty string stay apart.
    assert.deepEqual(body.result.rows[0].slice(0, 5), ["1", "Ada", "first", "9007199254740993", "12.5"]);
    assert.deepEqual(body.result.rows[1].slice(2, 3), [null]);
    assert.deepEqual(body.result.rows[2].slice(0, 3), ["9007199254740995", "Grace", ""]);
    assert.equal(body.result.rows[0][7], "ADA");

    const loose = (await rows(app, admin.cookie, base, "loose")).json();
    assert.deepEqual([loose.editing.editable, loose.editing.reason], [false, "no-primary-key"]);
    assert.deepEqual(loose.result.rows, [["x", "y"]]);
    const view = (await rows(app, admin.cookie, base, "people_view")).json();
    assert.deepEqual([view.editing.editable, view.editing.reason], [false, "no-primary-key"]);
    const refused = await edit(app, admin.cookie, base, {
      table: "loose",
      operations: [{ type: "insert", values: { a: "z" } }],
    });
    assert.equal(refused.statusCode, 409, refused.body);
    assert.deepEqual([refused.json().code, refused.json().reason], ["ROW_EDIT_NOT_EDITABLE", "no-primary-key"]);
  });
});

test("rows: a batch is previewed as the statements that run, then applied in one transaction and audited", async () => {
  await withApp(async (app) => {
    const admin = await makeUser(app, 1);
    const { id, filePath } = await sqliteConnection(app, admin.cookie);
    const base = `/api/admin/connections/${id}`;
    const operations = [
      {
        type: "delete",
        key: { id: "2" },
        original: (await rows(app, admin.cookie, base, "people")).json().result.rows[1],
      },
      ADA_RENAME,
      { type: "update", key: { id: "9007199254740995" }, original: { note: "" }, values: { note: null } },
      { type: "insert", values: { name: "O'Brien", score: "-9223372036854775808", price: "0.0001", active: "0" } },
      { type: "insert", values: { name: "Empty", note: "" } },
    ];
    // The whole row as displayed, by column name.
    const columns = (await rows(app, admin.cookie, base, "people")).json().result.columns as string[];
    operations[0].original = Object.fromEntries(columns.map((c, i) => [c, (operations[0].original as unknown[])[i]]));

    const preview = await edit(app, admin.cookie, base, { operations });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.deepEqual(preview.json(), {
      executed: false,
      counts: { insert: 2, update: 2, delete: 1 },
      sql: [
        `DELETE FROM "people" WHERE "id" = 2`,
        `UPDATE "people" SET "name" = 'Ada L.' WHERE "id" = 1`,
        `UPDATE "people" SET "note" = NULL WHERE "id" = 9007199254740995`,
        `INSERT INTO "people" ("name", "score", "price", "active") VALUES ('O''Brien', -9223372036854775808, 0.0001, 0)`,
        `INSERT INTO "people" ("name", "note") VALUES ('Empty', '')`,
      ],
    });
    assert.equal(peek<{ n: bigint }>(filePath, "SELECT COUNT(*) AS n FROM people").n, 3n, "a preview changes nothing");

    const applied = await edit(app, admin.cookie, base, { operations, execute: true });
    assert.equal(applied.statusCode, 200, applied.body);
    assert.equal(applied.json().executed, true);
    assert.equal(peek<{ n: bigint }>(filePath, "SELECT COUNT(*) AS n FROM people WHERE id = 2").n, 0n);
    assert.equal(peek<{ name: string }>(filePath, "SELECT name FROM people WHERE id = 1").name, "Ada L.");
    assert.equal(peek<{ note: null }>(filePath, "SELECT note FROM people WHERE id = 9007199254740995").note, null);
    const brien = peek<{ score: bigint; active: bigint; created: string }>(
      filePath,
      "SELECT score, active, created FROM people WHERE name = 'O''Brien'",
    );
    assert.deepEqual(brien, { score: -9223372036854775808n, active: 0n, created: "now" });
    assert.deepEqual(peek(filePath, "SELECT note, typeof(note) AS t FROM people WHERE name = 'Empty'"), {
      note: "",
      t: "text",
    });

    const audit = db
      .prepare("SELECT detail FROM audit_log WHERE action = 'dbadmin.rows' AND target_id = ?")
      .all(id) as { detail: string }[];
    assert.equal(audit.length, 1, "one entry per applied batch, none for the preview");
    assert.match(audit[0].detail, /^WRITE ok on people: 2 insert, 2 update, 1 delete \d+ms: DELETE FROM "people"/);
    const stats = db
      .prepare("SELECT normalized_sql, executions FROM query_stats WHERE connection_id = ? ORDER BY normalized_sql")
      .all(id) as { normalized_sql: string }[];
    assert.ok(stats.some((s) => s.normalized_sql === `UPDATE "people" SET "name" = ? WHERE "id" = ?`));
  });
});

test("rows: a stale row, a wrong row count or a refused statement apply nothing", async () => {
  await withApp(async (app) => {
    const admin = await makeUser(app, 1);
    const { id, filePath } = await sqliteConnection(app, admin.cookie);
    const base = `/api/admin/connections/${id}`;
    const count = () => peek<{ n: bigint }>(filePath, "SELECT COUNT(*) AS n FROM people").n;

    const insert = { type: "insert", values: { name: "Kept out" } };
    const stale = await edit(app, admin.cookie, base, {
      execute: true,
      operations: [insert, { ...ADA_RENAME, original: { name: "Somebody else" } }],
    });
    assert.equal(stale.statusCode, 409, stale.body);
    assert.deepEqual(
      [stale.json().code, stale.json().columns, stale.json().position, stale.json().missing],
      ["ROW_EDIT_STALE", ["name"], 2, false],
    );
    const gone = await edit(app, admin.cookie, base, {
      execute: true,
      operations: [{ ...ADA_RENAME, key: { id: "404" } }],
    });
    assert.deepEqual([gone.json().code, gone.json().missing], ["ROW_EDIT_STALE", true]);

    const ignored = await edit(app, admin.cookie, base, {
      table: "ignored",
      execute: true,
      operations: [{ type: "update", key: { id: "1" }, original: { v: "kept" }, values: { v: "changed" } }],
    });
    assert.equal(ignored.statusCode, 409, ignored.body);
    assert.deepEqual([ignored.json().code, ignored.json().affected], ["ROW_EDIT_ROW_COUNT", 0]);

    // The insert runs first and succeeds; the duplicate name then fails: neither stays.
    const failed = await edit(app, admin.cookie, base, {
      execute: true,
      operations: [insert, { type: "insert", values: { name: "Linus" } }],
    });
    assert.equal(failed.statusCode, 502, failed.body);
    assert.equal(failed.json().code, "ROW_EDIT_FAILED");
    assert.equal(failed.json().position, 2);
    assert.match(failed.json().reason, /UNIQUE constraint failed: people\.name/);
    assert.equal(failed.json().statement, `INSERT INTO "people" ("name") VALUES ('Linus')`);
    assert.equal(count(), 3n);
    const trail = db
      .prepare("SELECT detail FROM audit_log WHERE action = 'dbadmin.rows' AND target_id = ? ORDER BY rowid")
      .all(id) as { detail: string }[];
    assert.equal(trail.length, 4);
    assert.ok(trail.every((entry) => entry.detail.startsWith("WRITE failed, nothing applied on ")));
  });
});

test("rows: values are checked against the table before anything runs", async () => {
  await withApp(async (app) => {
    const admin = await makeUser(app, 1);
    const { id } = await sqliteConnection(app, admin.cookie);
    const base = `/api/admin/connections/${id}`;
    const refused = async (operations: unknown, code = "ROW_EDIT_INVALID") => {
      const res = await edit(app, admin.cookie, base, { operations });
      assert.equal(res.json().code, code, res.body);
    };
    await refused([]);
    await refused([{ type: "upsert", values: {} }]);
    await refused([{ type: "insert", values: { nope: "x" } }]);
    await refused([{ type: "insert", values: { score: 3 } }]);
    await refused([{ type: "insert", values: { score: "3.5" } }]);
    await refused([{ type: "insert", values: { price: "" } }]);
    await refused([{ type: "insert", values: { shout: "X" } }]);
    await refused([{ type: "insert", values: { photo: "0x00" } }]);
    await refused([{ ...ADA_RENAME, original: {} }]);
    await refused([{ ...ADA_RENAME, key: {} }]);
    await refused([{ ...ADA_RENAME, key: { id: null } }]);
    await refused([{ type: "delete", key: { id: "1" }, original: { name: "Ada" } }]);
    await refused([ADA_RENAME, { ...ADA_RENAME, values: { note: "x" }, original: { note: "first" } }]);
    await refused(
      Array.from({ length: MAX_ROW_OPERATIONS + 1 }, () => ({ type: "insert", values: {} })),
      "ROW_EDIT_LIMIT",
    );
    await refused([{ type: "insert", values: { note: "x".repeat(1024 * 1024 + 1) } }], "ROW_EDIT_LIMIT");

    // Nothing filled: every column takes its default.
    const empty = await edit(app, admin.cookie, base, {
      table: "ignored",
      operations: [{ type: "insert", values: {} }],
    });
    assert.deepEqual(empty.json().sql, [`INSERT INTO "ignored" DEFAULT VALUES`]);
  });
});

test("rows: awkward table and column names are quoted, values bound", async () => {
  await withApp(async (app) => {
    const admin = await makeUser(app, 1);
    const { id, filePath } = await sqliteConnection(app, admin.cookie);
    const base = `/api/admin/connections/${id}`;
    const table = `we"ird ta.ble`;
    const page = (await rows(app, admin.cookie, base, table)).json();
    assert.deepEqual(page.result.rows, [['a"b', "it's", "1"]]);
    const res = await edit(app, admin.cookie, base, {
      table,
      execute: true,
      operations: [
        {
          type: "update",
          key: { 'k"ey': 'a"b' },
          original: { "o'clock": "it's", "semi;colon": "1" },
          values: { "o'clock": "'); DROP TABLE people; --", "semi;colon": "2" },
        },
      ],
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json().sql, [
      `UPDATE "we""ird ta.ble" SET "o'clock" = '''); DROP TABLE people; --', "semi;colon" = 2 WHERE "k""ey" = 'a"b'`,
    ]);
    assert.deepEqual(peek(filePath, `SELECT "o'clock" AS v FROM "we""ird ta.ble"`), {
      v: "'); DROP TABLE people; --",
    });
    assert.equal(peek<{ n: bigint }>(filePath, "SELECT COUNT(*) AS n FROM people").n, 3n);
  });
});

test("rows: the rights of a write-mode statement, enforced on the server", async () => {
  await withApp(async (app) => {
    const admin = await makeUser(app, 1);
    const writer = await makeUser(app);
    const reader = await makeUser(app);
    const stranger = await makeUser(app);
    const { id, filePath } = await sqliteConnection(app, admin.cookie);
    for (const [user, level] of [
      [writer, "write"],
      [reader, "read"],
    ] as const) {
      const res = await call(app, admin.cookie, "PUT", `/api/admin/users/${user.id}/db-access`, {
        grants: [{ connectionId: id, level }],
      });
      assert.equal(res.statusCode, 200, res.body);
    }
    const base = `/api/connections/${id}`;
    const operations = [ADA_RENAME];

    // An administrator, on either family of routes.
    assert.equal((await edit(app, admin.cookie, base, { operations })).statusCode, 200);
    // `write`: a dry run as is, an apply only once confirmed.
    assert.equal((await rows(app, writer.cookie, base, "people")).json().editing.editable, true);
    assert.equal((await edit(app, writer.cookie, base, { operations })).statusCode, 200);
    const unconfirmed = await edit(app, writer.cookie, base, { operations, execute: true });
    assert.equal(unconfirmed.json().code, "DB_ACCESS_WRITE_CONFIRMATION_REQUIRED");
    const confirmed = await edit(app, writer.cookie, base, { operations, execute: true, confirmWrite: true });
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    assert.equal(peek<{ name: string }>(filePath, "SELECT name FROM people WHERE id = 1").name, "Ada L.");
    const memberTrail = db
      .prepare("SELECT detail FROM audit_log WHERE action = 'dbaccess.rows' AND actor_id = ?")
      .get(writer.id) as { detail: string };
    assert.match(memberTrail.detail, /^\[write access\] WRITE ok on people/);

    // `read`: rows, no editing, and the server refuses whatever is sent.
    const readerRows = (await rows(app, reader.cookie, base, "people")).json();
    assert.deepEqual([readerRows.editing.editable, readerRows.editing.reason], [false, "read-access"]);
    assert.equal(readerRows.result.rows.length, 3);
    for (const body of [{ operations }, { operations, execute: true, confirmWrite: true }]) {
      assert.equal((await edit(app, reader.cookie, base, body)).json().code, "DB_ACCESS_WRITE_FORBIDDEN");
    }
    // Nobody else, not even through the administrators' routes.
    assert.equal((await edit(app, stranger.cookie, base, { operations })).statusCode, 404);
    assert.equal((await edit(app, writer.cookie, `/api/admin/connections/${id}`, { operations })).statusCode, 403);
    assert.equal((await edit(app, "", base, { operations })).statusCode, 401);
  });
});

test("rows: a read-only connection is read, never edited; a personal-account one runs as the caller", async () => {
  await withApp(async (app) => {
    const admin = await makeUser(app, 1);
    const { id } = await sqliteConnection(app, admin.cookie, { readOnly: true });
    const base = `/api/admin/connections/${id}`;
    const page = (await rows(app, admin.cookie, base, "people")).json();
    assert.deepEqual([page.editing.editable, page.editing.reason], [false, "read-only-connection"]);
    for (const body of [{ operations: [ADA_RENAME] }, { operations: [ADA_RENAME], execute: true }]) {
      assert.equal((await edit(app, admin.cookie, base, body)).json().code, "CONNECTION_READ_ONLY");
    }

    const member = await makeUser(app);
    const personal = await call(app, admin.cookie, "POST", "/api/admin/connections", {
      name: "Personal",
      engine: "postgres",
      host: "127.0.0.1",
      port: 1,
      database: "shop",
      user: "nebula_service",
      password: "service-password",
      authMode: "personal",
    });
    const personalId = personal.json().connection.id as string;
    await call(app, admin.cookie, "PUT", `/api/admin/users/${member.id}/db-access`, {
      grants: [{ connectionId: personalId, level: "write", sqlUsername: "ada" }],
    });
    // The driver is opened with the caller's own account, and this caller has given none.
    const refused = await edit(app, member.cookie, `/api/connections/${personalId}`, {
      operations: [ADA_RENAME],
      execute: true,
      confirmWrite: true,
    });
    assert.equal(refused.json().code, "PERSONAL_CREDENTIALS_REQUIRED", refused.body);
  });
});

/** The other dialects' statements, built without a server. */
function describe(columns: [string, string, boolean?][]): DbAdminTableDescription {
  return {
    columns: columns.map(([name, type, primaryKey]) => ({
      name,
      type,
      nullable: true,
      defaultValue: null,
      primaryKey: primaryKey === true,
    })),
    indexes: [],
    constraints: [],
  };
}

test("rows: PostgreSQL and MySQL statements bind every value, and compare keys exactly", () => {
  const caller = { supported: true, access: "admin" as const, readOnly: false };
  const pg = describeRowEditing(
    "postgres",
    describe([
      ["id", "bigint", true],
      ["tags", "text[]"],
      ["ok", "boolean"],
      ["data", "bytea"],
    ]),
    caller,
  );
  assert.equal(pg.editable, true);
  assert.deepEqual(
    pg.columns.map((c) => [c.kind, c.readOnly]),
    [
      ["integer", null],
      ["other", null],
      ["boolean", null],
      ["binary", "binary"],
    ],
  );
  const [pgUpdate] = planRowEdits("postgres", { schema: "app", table: "t" }, pg, [
    {
      type: "update",
      key: { id: "9223372036854775807" },
      original: { ok: "true", tags: "{x}" },
      values: { ok: "false", tags: "{a,b}" },
    },
  ]);
  assert.equal(pgUpdate.sql, `UPDATE "app"."t" SET "ok" = $1, "tags" = $2 WHERE "id" = $3`);
  assert.deepEqual(pgUpdate.params, ["false", "{a,b}", "9223372036854775807"]);
  assert.equal(
    pgUpdate.display,
    `UPDATE "app"."t" SET "ok" = FALSE, "tags" = '{a,b}' WHERE "id" = 9223372036854775807`,
  );
  assert.equal(
    pgUpdate.check?.sql,
    `SELECT left("ok"::text, 10001) AS "ok", left("tags"::text, 10001) AS "tags" FROM "app"."t" WHERE "id" = $1 FOR UPDATE`,
  );

  const my = describeRowEditing(
    "mysql",
    describe([
      ["id", "bigint unsigned", true],
      ["amount", "decimal(30,6)", true],
      ["flag", "bit(1)"],
      ["path", "varchar(200)"],
    ]),
    caller,
  );
  assert.equal(my.columns.find((c) => c.name === "flag")?.readOnly, "unsupported");
  const [myDelete] = planRowEdits("mysql", { database: "shop", table: "t" }, my, [
    {
      type: "delete",
      key: { id: "18446744073709551615", amount: "1.5" },
      original: { id: "18446744073709551615", amount: "1.500000", flag: "1", path: "C:\\tmp\\x" },
    },
  ]);
  assert.equal(
    myDelete.sql,
    "DELETE FROM `t` WHERE `id` = CAST(? AS UNSIGNED) AND `amount` = CAST(? AS DECIMAL(30, 6))",
  );
  assert.equal(myDelete.display, "DELETE FROM `t` WHERE `id` = 18446744073709551615 AND `amount` = 1.5");
  const [myInsert] = planRowEdits("mysql", { table: "t" }, my, [{ type: "insert", values: { path: "C:\\tmp\\it's" } }]);
  assert.equal(myInsert.display, "INSERT INTO `t` (`path`) VALUES ('C:\\\\tmp\\\\it''s')");
  assert.deepEqual(myInsert.params, ["C:\\tmp\\it's"]);

  for (const engine of ["mssql", "oracle", "bigquery"] as const) {
    const editing = describeRowEditing(engine, describe([["id", "int", true]]), { ...caller, supported: false });
    assert.deepEqual([editing.editable, editing.reason], [false, "engine"]);
  }
});
