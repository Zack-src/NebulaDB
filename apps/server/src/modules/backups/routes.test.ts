import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import Database from "better-sqlite3";

process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-backups-${randomUUID()}`, "app.sqlite");
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
process.env.ATHANORDB_LOG_LEVEL = "silent";
// The smallest ceiling the setting accepts, so the "too large" case stays a small test.
process.env.ATHANORDB_DATABASE_BACKUP_MAX_MB = "1";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms, getRoom } = await import("../../realtime/roomRegistry.js");
const { writeProjectToDoc } = await import("@athanordb/shared");
const { backupFilePath } = await import("./storage.js");
const { failInterruptedBackups, insertBackup, purgeExpiredBackups } = await import("./repository.js");
const { backupPageSql, fromBackupCell, tablesInBackupOrder, toBackupCell } = await import("./format.js");

type App = Awaited<ReturnType<typeof buildApp>>;
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const HOST = "localhost:3001";
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `http://${HOST}`, ...extra });

async function login(app: App, isAdmin: 0 | 1): Promise<string> {
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

function call(app: App, cookie: string, method: Method, url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: headers({ cookie }),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

const SHOP = `
  CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), total REAL, memo TEXT);
  CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, big INTEGER, avatar BLOB);
  CREATE TABLE notes (body TEXT);
  INSERT INTO customers (id, name, big, avatar) VALUES (1, 'Ada Lovelace', 9007199254740993, x'00ff10'), (2, '', NULL, NULL);
  INSERT INTO orders (id, customer_id, total, memo) VALUES (10, 1, 12.5, 'first'), (11, 2, 0, NULL), (12, 1, 99.99, 'line
break, "quoted"');
  INSERT INTO notes (body) VALUES ('no primary key here');
`;

function targetFile(sql: string): string {
  const file = join(tmpdir(), `athanordb-test-backups-target-${randomUUID()}.sqlite`);
  const target = new Database(file);
  target.exec(sql);
  target.close();
  return file;
}

function dump(file: string): Record<string, unknown[]> {
  const target = new Database(file, { readonly: true });
  target.defaultSafeIntegers(true);
  try {
    return {
      customers: target.prepare("SELECT * FROM customers ORDER BY id").all(),
      orders: target.prepare("SELECT * FROM orders ORDER BY id").all(),
      notes: target.prepare("SELECT * FROM notes").all(),
    };
  } finally {
    target.close();
  }
}

async function connect(app: App, cookie: string, name: string, filePath: string, extra: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/api/admin/connections",
    headers: headers({ cookie }),
    payload: { name, engine: "sqlite", filePath, ...extra },
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json().connection.id as string;
}

interface Backup {
  id: string;
  status: string;
  trigger: string;
  tables: { name: string; columns: string[]; rows: number }[];
  tablesTotal: number;
  rows: number;
  sizeBytes: number | null;
  checksum: string | null;
  error: string | null;
  pinned: boolean;
  expiresAt: string | null;
}

/** Starts a backup and waits for it to end, the way the tab does: by reading the list again. */
async function backUp(app: App, cookie: string, connId: string, body: unknown = {}): Promise<Backup> {
  const started = await call(app, cookie, "POST", `/api/admin/connections/${connId}/backups`, body);
  assert.equal(started.statusCode, 202, started.body);
  const { id } = started.json().backup as Backup;
  for (let i = 0; i < 400; i++) {
    const { backups } = (await call(app, cookie, "GET", `/api/admin/connections/${connId}/backups`)).json() as {
      backups: Backup[];
    };
    const backup = backups.find((b) => b.id === id)!;
    if (backup.status !== "running") return backup;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("the backup never finished");
}

test("backup cells keep what the driver returned; pages are written in each engine's dialect", () => {
  assert.equal(toBackupCell(null), null);
  assert.equal(toBackupCell(9007199254740993n), "9007199254740993");
  assert.equal(toBackupCell(12.5), "12.5");
  assert.equal(toBackupCell(true), "true");
  assert.equal(toBackupCell(new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 6))), "2026-01-02 03:04:05.006");
  assert.equal(toBackupCell({ a: 1 }), '{"a":1}');
  const bytes = toBackupCell(Buffer.from([0, 255, 16]));
  assert.deepEqual(bytes, { $b: "AP8Q" });
  assert.deepEqual([...(fromBackupCell(bytes) as Uint8Array)], [0, 255, 16]);
  assert.equal(fromBackupCell(""), "");

  assert.equal(
    backupPageSql("postgres", "orders", ["id", "total"], ["id"], 100, 200),
    'SELECT "id", "total" FROM "orders" ORDER BY "id" LIMIT 100 OFFSET 200',
  );
  assert.equal(backupPageSql("mysql", "t", ["a"], [], 10, 0), "SELECT `a` FROM `t` LIMIT 10 OFFSET 0");
  assert.equal(
    backupPageSql("mssql", "t", ["a"], [], 10, 20),
    "SELECT [a] FROM [t] ORDER BY (SELECT NULL) OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY",
  );
  assert.equal(
    backupPageSql("oracle", "t", ["a"], ["a"], 10, 20),
    'SELECT "a" FROM "t" ORDER BY "a" OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY',
  );
});

test("tables are stored parents first, and an unknown table name is refused", () => {
  const table = (id: string) => ({
    id,
    name: id,
    fields: [{ id: `${id}.id`, name: "id", type: "integer", pk: true }],
    indexes: [],
    position: { x: 0, y: 0 },
    detailLevel: "standard" as const,
  });
  const project = {
    id: "p",
    name: "p",
    tables: [table("orders"), table("customers")],
    refs: [
      {
        id: "r",
        from: { tableId: "orders", fieldId: "orders.id" },
        to: { tableId: "customers", fieldId: "customers.id" },
        cardinality: "one-to-many" as const,
      },
    ],
    enums: [],
    zones: [],
    stickyNotes: [],
    tableGroups: [],
  };
  assert.deepEqual(
    tablesInBackupOrder(project, null).map((t) => t.name),
    ["customers", "orders"],
  );
  assert.deepEqual(
    tablesInBackupOrder(project, ["ORDERS"]).map((t) => t.name),
    ["orders"],
  );
  assert.throws(() => tablesInBackupOrder(project, ["nope"]), /no such table/);
});

test("backups: only instance administrators", async () => {
  const app = await buildApp();
  try {
    const member = await login(app, 0);
    const routes: [Method, string][] = [
      ["GET", "/api/admin/connections/x/backups"],
      ["POST", "/api/admin/connections/x/backups"],
      ["POST", "/api/admin/backups/x/cancel"],
      ["PATCH", "/api/admin/backups/x"],
      ["DELETE", "/api/admin/backups/x"],
      ["GET", "/api/admin/backups/x/download"],
      ["POST", "/api/admin/backups/x/restore"],
    ];
    for (const [method, url] of routes) {
      assert.equal((await call(app, member, method, url, method === "GET" ? undefined : {})).statusCode, 403, url);
      const anonymous = await app.inject({ method, url, headers: headers() });
      assert.equal(anonymous.statusCode, 401, url);
    }
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("a backup is taken, stored encrypted, downloaded, and restored over changed data", async () => {
  const app = await buildApp();
  try {
    const admin = await login(app, 1);
    const file = targetFile(SHOP);
    const original = dump(file);
    const connId = await connect(app, admin, "Shop", file);

    const backup = await backUp(app, admin, connId, { note: "before the sale" });
    assert.equal(backup.status, "done", backup.error ?? "");
    assert.equal(backup.trigger, "manual");
    // customers before orders, although orders was created first: the order a restore inserts in.
    const names = backup.tables.map((t) => t.name);
    assert.ok(names.indexOf("customers") < names.indexOf("orders"), names.join());
    assert.equal(backup.tablesTotal, 3);
    assert.equal(backup.rows, 6);
    assert.deepEqual(backup.tables.find((t) => t.name === "orders")?.columns, ["id", "customer_id", "total", "memo"]);
    assert.ok(backup.sizeBytes! > 0);
    assert.match(backup.checksum!, /^[0-9a-f]{64}$/);
    assert.ok(backup.expiresAt, "kept for the default retention");

    // On disk: neither readable nor a plain gzip.
    const stored = readFileSync(backupFilePath(backup.id));
    assert.equal(stored.includes("Ada Lovelace"), false);
    assert.throws(() => gunzipSync(stored));

    const download = await call(app, admin, "GET", `/api/admin/backups/${backup.id}/download`);
    assert.equal(download.statusCode, 200);
    assert.match(String(download.headers["content-disposition"]), /Shop-\d+\.jsonl\.gz/);
    const lines = gunzipSync(download.rawPayload)
      .toString("utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as unknown);
    assert.deepEqual((lines[0] as { format: string; version: number }).format, "athanordb-backup");
    assert.ok(
      lines.some((line) => Array.isArray(line) && line[1] === "Ada Lovelace" && line[2] === "9007199254740993"),
    );
    assert.ok(lines.some((line) => Array.isArray(line) && line[3] === 'line\nbreak, "quoted"'));

    // The data moves on: a customer and their orders go, a row changes, another arrives.
    const target = new Database(file);
    target.exec(`
      DELETE FROM orders WHERE customer_id = 1; DELETE FROM customers WHERE id = 1;
      UPDATE customers SET name = 'changed' WHERE id = 2;
      INSERT INTO customers (id, name) VALUES (3, 'newcomer');
      DELETE FROM notes;
    `);
    target.close();

    const restore = (body: unknown) => call(app, admin, "POST", `/api/admin/backups/${backup.id}/restore`, body);
    // Nothing happens without the target's name retyped.
    assert.equal((await restore({})).json().code, "RESTORE_CONFIRMATION_REQUIRED");
    assert.equal((await restore({ confirmName: "shop" })).json().code, "RESTORE_CONFIRMATION_REQUIRED");
    // Emptying `customers` alone would break (or cascade into) `orders`.
    const alone = (await restore({ confirmName: "Shop", tables: ["customers"] })).json();
    assert.equal(alone.code, "RESTORE_TARGET_MISMATCH");
    assert.deepEqual(alone.dependents, ["orders"]);
    assert.equal((await restore({ confirmName: "Shop", tables: ["nope"] })).json().code, "BACKUP_INVALID");
    assert.equal(dump(file).customers.length, 2, "refusals touch nothing");

    const restored = await restore({ confirmName: "Shop" });
    assert.equal(restored.statusCode, 200, restored.body);
    const { result } = restored.json() as {
      result: {
        success: boolean;
        safetyBackupId: string;
        tables: { name: string; deleted: number; inserted: number }[];
      };
    };
    assert.equal(result.success, true);
    assert.deepEqual(
      result.tables.find((t) => t.name === "customers"),
      { name: "customers", deleted: 2, inserted: 2 },
    );
    assert.deepEqual(dump(file), original);

    // What was there just before the restore was kept, and says why.
    const { backups, usedBytes } = (
      await call(app, admin, "GET", `/api/admin/connections/${connId}/backups`)
    ).json() as {
      backups: Backup[];
      usedBytes: number;
    };
    const safety = backups.find((b) => b.id === result.safetyBackupId)!;
    assert.equal(safety.trigger, "pre-restore");
    assert.equal(safety.status, "done");
    assert.equal(safety.tables.find((t) => t.name === "customers")?.rows, 2);
    assert.equal(usedBytes, backup.sizeBytes! + safety.sizeBytes!);

    const actions = (
      db.prepare("SELECT action FROM audit_log WHERE action LIKE 'backup.%' ORDER BY rowid").all() as {
        action: string;
      }[]
    ).map((row) => row.action);
    assert.deepEqual(actions, ["backup.create", "backup.download", "backup.restore"]);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("a restore refuses a read-only target, a target missing a column, and a file that was altered", async () => {
  const app = await buildApp();
  try {
    const admin = await login(app, 1);
    const file = targetFile(SHOP);
    const connId = await connect(app, admin, "Source", file);
    const backup = await backUp(app, admin, connId, { tables: ["notes", "customers"] });
    assert.equal(backup.status, "done", backup.error ?? "");
    assert.equal(backup.tablesTotal, 2);

    const restore = (body: Record<string, unknown>) =>
      call(app, admin, "POST", `/api/admin/backups/${backup.id}/restore`, body);

    const readOnly = await connect(app, admin, "Frozen", targetFile(SHOP), { readOnly: true });
    assert.equal(
      (await restore({ connectionId: readOnly, confirmName: "Frozen" })).json().code,
      "CONNECTION_READ_ONLY",
    );

    const narrower = targetFile(
      "CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE notes (body TEXT);",
    );
    const other = await connect(app, admin, "Narrow", narrower);
    const refused = (await restore({ connectionId: other, confirmName: "Narrow" })).json();
    assert.equal(refused.code, "RESTORE_TARGET_MISMATCH");
    assert.deepEqual(refused.missing, [{ table: "customers", columns: ["big", "avatar"] }]);
    // Checked before the safety backup, which would otherwise pile up on every refusal.
    assert.equal((await call(app, admin, "GET", `/api/admin/connections/${other}/backups`)).json().backups.length, 0);

    // Another connection with the same tables takes the rows; the optional safety copy can be declined.
    const twin = targetFile(SHOP.replace(/INSERT INTO[^;]+;/g, ""));
    const twinId = await connect(app, admin, "Twin", twin);
    const copied = (
      await restore({ connectionId: twinId, confirmName: "Twin", tables: ["notes"], skipSafetyBackup: true })
    ).json().result;
    assert.deepEqual(copied, {
      success: true,
      tables: [{ name: "notes", deleted: 0, inserted: 1 }],
      safetyBackupId: null,
    });

    const path = backupFilePath(backup.id);
    const bytes = readFileSync(path);
    bytes[bytes.length - 1] ^= 0xff;
    writeFileSync(path, bytes);
    assert.equal((await restore({ confirmName: "Source" })).json().code, "BACKUP_CORRUPTED");
    assert.equal(
      (await call(app, admin, "GET", `/api/admin/backups/${backup.id}/download`)).json().code,
      "BACKUP_CORRUPTED",
    );
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("a backup over the size ceiling fails and leaves no file; pin, retention, delete, restart", async () => {
  const app = await buildApp();
  try {
    const admin = await login(app, 1);
    const big = targetFile("CREATE TABLE blobs (id INTEGER PRIMARY KEY, body TEXT);");
    const filler = new Database(big);
    const insert = filler.prepare("INSERT INTO blobs (body) VALUES (?)");
    for (let i = 0; i < 30; i++) insert.run("x".repeat(50_000));
    filler.close();
    const bigId = await connect(app, admin, "Big", big);
    const tooLarge = await backUp(app, admin, bigId);
    assert.equal(tooLarge.status, "failed");
    assert.match(tooLarge.error!, /ATHANORDB_DATABASE_BACKUP_MAX_MB/);
    assert.equal(existsSync(backupFilePath(tooLarge.id)), false);
    assert.equal(
      (await call(app, admin, "GET", `/api/admin/backups/${tooLarge.id}/download`)).json().code,
      "BACKUP_NOT_READY",
    );
    assert.equal(
      (await call(app, admin, "POST", `/api/admin/backups/${tooLarge.id}/cancel`)).json().code,
      "BACKUP_NOT_READY",
    );

    const connId = await connect(app, admin, "Small", targetFile(SHOP));
    const kept = await backUp(app, admin, connId);
    const old = await backUp(app, admin, connId);
    assert.equal((await call(app, admin, "PATCH", `/api/admin/backups/${kept.id}`, { pinned: "yes" })).statusCode, 400);
    const pinned = (await call(app, admin, "PATCH", `/api/admin/backups/${kept.id}`, { pinned: true })).json().backup;
    assert.equal(pinned.pinned, true);
    assert.equal(pinned.expiresAt, null);

    // Both are made a year old: the pinned one stays, the other goes with its file.
    db.prepare("UPDATE backups SET started_at = datetime('now', '-365 days') WHERE id IN (?, ?)").run(kept.id, old.id);
    assert.equal(purgeExpiredBackups(), 1);
    assert.equal(existsSync(backupFilePath(old.id)), false);
    assert.equal(existsSync(backupFilePath(kept.id)), true);

    // A backup still "running" at boot was cut short by the restart.
    const ghost = insertBackup({
      connectionId: connId,
      connectionName: "Small",
      engine: "sqlite",
      trigger: "manual",
      scope: null,
      note: null,
      createdBy: null,
    });
    assert.equal(
      (await call(app, admin, "POST", `/api/admin/connections/${connId}/backups`, {})).json().code,
      "BACKUP_ALREADY_RUNNING",
    );
    assert.equal((await call(app, admin, "DELETE", `/api/admin/backups/${ghost}`)).json().code, "BACKUP_NOT_READY");
    assert.equal(failInterruptedBackups(), 1);
    assert.equal((await call(app, admin, "DELETE", `/api/admin/backups/${ghost}`)).statusCode, 200);

    // Deleting the connection takes its backups, files included.
    assert.equal((await call(app, admin, "DELETE", `/api/admin/connections/${connId}`)).statusCode, 200);
    assert.equal(existsSync(backupFilePath(kept.id)), false);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM backups WHERE connection_id = ?").get(connId) as { n: number }).n,
      0,
    );
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("a production deployment backs the database up first — or does not happen", async () => {
  const app = await buildApp();
  try {
    const admin = await login(app, 1);
    const project = (await call(app, admin, "POST", "/api/projects", { name: "Shop" })).json() as { id: string };
    const column = (name: string, pk = false) => ({ id: `f-${name}`, name, type: pk ? "integer" : "text", pk });
    const write = (fields: ReturnType<typeof column>[]) => {
      const room = getRoom(project.id);
      room.doc.transact(() => {
        writeProjectToDoc(room.doc, {
          id: project.id,
          name: "Shop",
          tables: [
            { id: "t-blobs", name: "blobs", fields, indexes: [], position: { x: 0, y: 0 }, detailLevel: "standard" },
          ],
          refs: [],
          enums: [],
          zones: [],
          stickyNotes: [],
          tableGroups: [],
        });
      }, "test-seed");
    };
    const file = targetFile(
      "CREATE TABLE blobs (id INTEGER PRIMARY KEY, body TEXT); INSERT INTO blobs (body) VALUES ('kept');",
    );
    const base = `/api/projects/${project.id}/connections`;
    const created = await call(app, admin, "POST", base, {
      name: "Live",
      engine: "sqlite",
      filePath: file,
      environment: "Prod",
    });
    assert.equal(created.json().connection.production, true, created.body);
    const connId = created.json().connection.id as string;
    const deploy = (body: Record<string, unknown>) =>
      call(app, admin, "POST", `${base}/${connId}/apply-deployment`, { confirmName: "Live", ...body });
    const backups = async () =>
      (await call(app, admin, "GET", `/api/admin/connections/${connId}/backups`)).json().backups as Backup[];

    // Nothing to change: nothing to protect, no backup.
    write([column("id", true), column("body")]);
    assert.equal((await deploy({})).json().backupId, null);
    assert.equal((await backups()).length, 0);

    // A change on the production stage: the backup comes first, and the history says which.
    write([column("id", true), column("body"), column("label")]);
    const deployed = await deploy({});
    assert.equal(deployed.statusCode, 200, deployed.body);
    const [backup] = await backups();
    assert.equal(deployed.json().backupId, backup.id);
    assert.equal(backup.trigger, "pre-deployment");
    assert.equal(backup.status, "done");
    assert.deepEqual(backup.tables[0].columns, ["id", "body"], "taken before the column was added");
    const history = (await call(app, admin, "GET", `${base}/${connId}/history`)).json().history as {
      backupId?: string;
    }[];
    assert.equal(history[0].backupId, backup.id);

    // Explicitly without.
    write([column("id", true), column("body"), column("label"), column("extra")]);
    assert.equal((await deploy({ backupBefore: false })).json().backupId, null);
    assert.equal((await backups()).length, 1);

    // The database outgrows what a logical backup may read: the deployment is refused, untouched.
    const filler = new Database(file);
    const insert = filler.prepare("INSERT INTO blobs (body) VALUES (?)");
    for (let i = 0; i < 30; i++) insert.run("x".repeat(50_000));
    filler.close();
    write([column("id", true), column("body"), column("label"), column("extra"), column("more")]);
    const refused = await deploy({});
    assert.equal(refused.statusCode, 502);
    assert.equal(refused.json().code, "BACKUP_FAILED");
    const after = new Database(file, { readonly: true });
    const columns = (after.prepare("PRAGMA table_info(blobs)").all() as { name: string }[]).map((c) => c.name);
    after.close();
    assert.deepEqual(columns, ["id", "body", "label", "extra"]);
  } finally {
    closeAllRooms();
    await app.close();
  }
});
