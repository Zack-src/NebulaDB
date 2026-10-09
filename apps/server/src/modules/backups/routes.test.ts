import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import Database from "better-sqlite3";

process.env.NEBULADB_DB_PATH = join(tmpdir(), `nebuladb-test-backups-${randomUUID()}`, "app.sqlite");
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";
// The smallest ceiling the setting accepts, so the "too large" case stays a small test.
process.env.NEBULADB_DATABASE_BACKUP_MAX_MB = "1";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms, getRoom } = await import("../../realtime/roomRegistry.js");
const { writeProjectToDoc } = await import("@nebuladb/shared");
const { backupFilePath, openBackupWriter } = await import("./storage.js");
const { failInterruptedBackups, insertBackup, purgeExpiredBackups } = await import("./repository.js");
const { backupPageSql, fromBackupCell, tablesInBackupOrder, toBackupCell } = await import("./format.js");
const { runDueBackupSchedules } = await import("./schedule.js");

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
  return `nebuladb_sid=${res.cookies.find((c) => c.name === "nebuladb_sid")!.value}`;
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
  const file = join(tmpdir(), `nebuladb-test-backups-target-${randomUUID()}.sqlite`);
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
      ["PUT", "/api/admin/connections/x/backup-schedule"],
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
    assert.deepEqual((lines[0] as { format: string; version: number }).format, "nebuladb-backup");
    assert.ok(
      lines.some((line) => Array.isArray(line) && line[1] === "Ada Lovelace" && line[2] === "9007199254740993"),
    );
    assert.ok(lines.some((line) => Array.isArray(line) && line[3] === 'line\nbreak, "quoted"'));

    // A backup made before the rename must still restore real rows.
    (lines[0] as { format: string }).format = "athanordb-backup";
    const legacyWriter = openBackupWriter(backup.id);
    for (const line of lines) await legacyWriter.write(line);
    const legacyStored = await legacyWriter.finish();
    db.prepare("UPDATE backups SET key_encrypted = ?, checksum = ?, size_bytes = ? WHERE id = ?").run(
      legacyStored.keyEncrypted,
      legacyStored.checksum,
      legacyStored.sizeBytes,
      backup.id,
    );
    backup.sizeBytes = legacyStored.sizeBytes;

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

test("a connection's backups go to the folder chosen for it; the earlier ones stay readable where they are", async () => {
  const app = await buildApp();
  try {
    const admin = await login(app, 1);
    const member = await login(app, 0);
    const connId = await connect(app, admin, "Elsewhere", targetFile(SHOP));
    const url = `/api/admin/connections/${connId}/backup-destination`;
    const first = await backUp(app, admin, connId);
    const defaultPath = backupFilePath(first.id);

    assert.equal((await call(app, member, "PUT", url, { directory: "/tmp" })).statusCode, 403);
    assert.equal(
      (await call(app, admin, "PUT", url, { directory: "relative/folder" })).json().code,
      "BACKUP_DESTINATION_INVALID",
    );
    // A file where a folder is wanted: nothing can be written under it.
    const unusable = await call(app, admin, "PUT", url, { directory: join(defaultPath, "sub") });
    assert.equal(unusable.json().code, "BACKUP_DESTINATION_UNUSABLE");
    assert.ok(unusable.json().reason);

    const share = join(mkdtempSync(join(tmpdir(), "nebuladb-share-")), "crm", "backups");
    const saved = await call(app, admin, "PUT", url, { directory: share });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().destination.directory, share);
    assert.equal(
      (await call(app, admin, "GET", `/api/admin/connections/${connId}/backups`)).json().destination.directory,
      share,
    );

    const second = await backUp(app, admin, connId);
    assert.equal(second.status, "done", second.error ?? "");
    assert.equal(backupFilePath(second.id), join(share, `${second.id}.bak`));
    assert.equal(existsSync(backupFilePath(second.id)), true);
    // The one taken before has not moved, and still downloads.
    assert.equal(backupFilePath(first.id), defaultPath);
    assert.equal((await call(app, admin, "GET", `/api/admin/backups/${first.id}/download`)).statusCode, 200);
    assert.equal((await call(app, admin, "GET", `/api/admin/backups/${second.id}/download`)).statusCode, 200);

    await call(app, admin, "DELETE", `/api/admin/backups/${second.id}`);
    assert.equal(existsSync(join(share, `${second.id}.bak`)), false);

    assert.equal((await call(app, admin, "PUT", url, { directory: null })).json().destination.directory, null);
  } finally {
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
    assert.match(tooLarge.error!, /NEBULADB_DATABASE_BACKUP_MAX_MB/);
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

test("a running backup can be cancelled, and leaves no file", async () => {
  const app = await buildApp();
  try {
    const admin = await login(app, 1);
    const file = targetFile("CREATE TABLE events (id INTEGER PRIMARY KEY, label TEXT);");
    const filler = new Database(file);
    const insert = filler.prepare("INSERT INTO events (label) VALUES (?)");
    filler.transaction(() => {
      for (let i = 0; i < 40_000; i++) insert.run("event");
    })();
    filler.close();
    const connId = await connect(app, admin, "Events", file);
    const started = await call(app, admin, "POST", `/api/admin/connections/${connId}/backups`, {});
    const { id } = started.json().backup as Backup;
    // Twenty pages to read: the cancel lands between two of them.
    assert.equal((await call(app, admin, "POST", `/api/admin/backups/${id}/cancel`)).statusCode, 200);
    let backup: Backup | undefined;
    for (let i = 0; i < 400 && backup?.status !== "cancelled"; i++) {
      const list = (await call(app, admin, "GET", `/api/admin/connections/${connId}/backups`)).json();
      backup = (list.backups as Backup[]).find((b) => b.id === id);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(backup?.status, "cancelled");
    assert.equal(existsSync(backupFilePath(id)), false);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("/api/v1 backups: taken, polled, listed, downloaded and deleted with an administrator's unrestricted key", async () => {
  const app = await buildApp();
  try {
    const admin = await login(app, 1);
    const member = await login(app, 0);
    const file = targetFile(SHOP);
    const connId = await connect(app, admin, "Shop v1", file);
    const key = async (cookie: string, scopes: string[], projectId?: string) => {
      const res = await call(app, cookie, "POST", "/api/keys", { name: "backups", scopes, projectId });
      assert.equal(res.statusCode, 201, res.body);
      return res.json().plaintextKey as string;
    };
    const withKey = (plaintext: string | null, method: Method, url: string, payload?: unknown) =>
      app.inject({
        method,
        url,
        headers: { host: HOST, ...(plaintext ? { authorization: `Bearer ${plaintext}` } : {}) },
        ...(payload === undefined ? {} : { payload: payload as object }),
      });
    const project = (await call(app, admin, "POST", "/api/projects", { name: "Shop schema" })).json() as { id: string };
    const manageKey = await key(admin, ["connections:manage"]);
    const readKey = await key(admin, ["projects:read", "projects:write", "deployments:trigger"]);
    const restrictedKey = await key(admin, ["connections:manage"], project.id);
    const memberKey = await key(member, ["connections:manage"]);

    const routes: [Method, string][] = [
      ["GET", `/api/v1/connections/${connId}/backups`],
      ["POST", `/api/v1/connections/${connId}/backups`],
      ["GET", "/api/v1/backups/x"],
      ["POST", "/api/v1/backups/x/cancel"],
      ["DELETE", "/api/v1/backups/x"],
      ["GET", "/api/v1/backups/x/download"],
    ];
    for (const [method, url] of routes) {
      const body = method === "POST" ? {} : undefined;
      assert.equal((await withKey(null, method, url, body)).statusCode, 401, url);
      // The right scope is not enough: the key's owner is no instance administrator.
      const asMember = await withKey(memberKey, method, url, body);
      assert.deepEqual([asMember.statusCode, asMember.json().code], [403, "ADMIN_REQUIRED"], url);
      const unscoped = await withKey(readKey, method, url, body);
      assert.deepEqual([unscoped.statusCode, unscoped.json().code], [403, "API_SCOPE_INSUFFICIENT"], url);
      // A key narrowed to one project does not reach a database of the instance.
      const restricted = await withKey(restrictedKey, method, url, body);
      assert.deepEqual([restricted.statusCode, restricted.json().code], [403, "API_KEY_PROJECT_RESTRICTED"], url);
    }
    // There is no restore here, with any key.
    assert.equal((await withKey(manageKey, "POST", "/api/v1/backups/x/restore", {})).statusCode, 404);

    const list = `/api/v1/connections/${connId}/backups`;
    assert.equal(
      (await withKey(manageKey, "GET", "/api/v1/connections/nope/backups")).json().code,
      "CONNECTION_NOT_FOUND",
    );
    assert.equal((await withKey(manageKey, "GET", "/api/v1/backups/nope")).json().code, "BACKUP_NOT_FOUND");
    assert.equal((await withKey(manageKey, "POST", list, { tables: "orders" })).json().code, "BACKUP_INVALID");

    const started = await withKey(manageKey, "POST", list, { tables: ["customers"], note: " nightly job " });
    assert.equal(started.statusCode, 202, started.body);
    const { id } = started.json().backup as Backup;
    let backup = started.json().backup as Backup & { note: string | null; scope: string[] | null };
    for (let i = 0; i < 400 && backup.status === "running"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      backup = (await withKey(manageKey, "GET", `/api/v1/backups/${id}`)).json().backup;
    }
    assert.equal(backup.status, "done", backup.error ?? "");
    assert.equal(backup.trigger, "manual");
    assert.equal(backup.note, "nightly job");
    assert.deepEqual(backup.scope, ["customers"]);
    assert.deepEqual(
      backup.tables.map((t) => [t.name, t.rows]),
      [["customers", 2]],
    );

    const listed = (await withKey(manageKey, "GET", list)).json() as { backups: Backup[]; usedBytes: number };
    assert.deepEqual(
      listed.backups.map((b) => b.id),
      [id],
    );
    assert.equal(listed.usedBytes, backup.sizeBytes);
    // The same record the app shows.
    const inApp = (await call(app, admin, "GET", `/api/admin/connections/${connId}/backups`)).json();
    assert.deepEqual(inApp.backups, listed.backups);

    const download = await withKey(manageKey, "GET", `/api/v1/backups/${id}/download`);
    assert.equal(download.statusCode, 200, download.body);
    assert.equal(download.headers["content-type"], "application/gzip");
    assert.match(String(download.headers["content-disposition"]), /Shop_v1-\d+\.jsonl\.gz/);
    const lines = gunzipSync(download.rawPayload)
      .toString("utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as unknown);
    assert.deepEqual(lines[0] && (lines[0] as { format: string; tables: string[] }).tables, ["customers"]);
    assert.ok(lines.some((line) => Array.isArray(line) && line[1] === "Ada Lovelace"));
    assert.deepEqual(lines.at(-1), { end: "customers", rows: 2 });

    // A finished backup has nothing to cancel.
    assert.equal((await withKey(manageKey, "POST", `/api/v1/backups/${id}/cancel`)).json().code, "BACKUP_NOT_READY");
    const deleted = await withKey(manageKey, "DELETE", `/api/v1/backups/${id}`);
    assert.deepEqual([deleted.statusCode, deleted.json()], [200, { deleted: true }]);
    assert.equal(existsSync(backupFilePath(id)), false);
    assert.equal((await withKey(manageKey, "GET", `/api/v1/backups/${id}`)).statusCode, 404);
    assert.deepEqual((await withKey(manageKey, "GET", list)).json().backups, []);

    // Recorded as the app's own actions are; a refused call records nothing.
    const actions = (
      db
        .prepare("SELECT action FROM audit_log WHERE action LIKE 'backup.%' AND target_id = ? ORDER BY rowid")
        .all(connId) as { action: string }[]
    ).map((row) => row.action);
    assert.deepEqual(actions, ["backup.create", "backup.download", "backup.delete"]);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("/api/v1 backups: a running backup is cancelled with a key", async () => {
  const app = await buildApp();
  try {
    const admin = await login(app, 1);
    const file = targetFile("CREATE TABLE events (id INTEGER PRIMARY KEY, label TEXT);");
    const filler = new Database(file);
    const insert = filler.prepare("INSERT INTO events (label) VALUES (?)");
    filler.transaction(() => {
      for (let i = 0; i < 40_000; i++) insert.run("event");
    })();
    filler.close();
    const connId = await connect(app, admin, "Events v1", file);
    const created = await call(app, admin, "POST", "/api/keys", { name: "backups", scopes: ["connections:manage"] });
    const authorization = `Bearer ${created.json().plaintextKey as string}`;
    const withKey = (method: Method, url: string, payload?: unknown) =>
      app.inject({
        method,
        url,
        headers: { host: HOST, authorization },
        ...(payload === undefined ? {} : { payload: payload as object }),
      });

    const started = await withKey("POST", `/api/v1/connections/${connId}/backups`, {});
    const { id } = started.json().backup as Backup;
    // One at a time per database, and a running one is not deleted from under its writer.
    assert.equal(
      (await withKey("POST", `/api/v1/connections/${connId}/backups`, {})).json().code,
      "BACKUP_ALREADY_RUNNING",
    );
    assert.equal((await withKey("DELETE", `/api/v1/backups/${id}`)).json().code, "BACKUP_NOT_READY");
    assert.equal((await withKey("GET", `/api/v1/backups/${id}/download`)).json().code, "BACKUP_NOT_READY");
    assert.deepEqual((await withKey("POST", `/api/v1/backups/${id}/cancel`)).json(), { cancelling: true });
    let status = "running";
    for (let i = 0; i < 400 && status === "running"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      status = ((await withKey("GET", `/api/v1/backups/${id}`)).json().backup as Backup).status;
    }
    assert.equal(status, "cancelled");
    assert.equal(existsSync(backupFilePath(id)), false);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("a schedule fires once per occurrence, never for a past one, and keeps the last N", async () => {
  const app = await buildApp();
  try {
    const admin = await login(app, 1);
    const connId = await connect(app, admin, "Nightly", targetFile(SHOP));
    const url = `/api/admin/connections/${connId}/backup-schedule`;
    const list = async () =>
      (await call(app, admin, "GET", `/api/admin/connections/${connId}/backups`)).json() as {
        backups: Backup[];
        schedule: { enabled: boolean; keep: number; nextRunAt: string | null; lastStatus: string | null };
      };
    assert.deepEqual((await list()).schedule, {
      enabled: false,
      frequency: "daily",
      hour: 2,
      weekday: 1,
      dayOfMonth: 1,
      keep: 7,
      lastRunAt: null,
      lastStatus: null,
      nextRunAt: null,
    });

    const settings = { enabled: true, frequency: "daily", hour: 2, weekday: 1, dayOfMonth: 1, keep: 2 };
    for (const bad of [{ ...settings, hour: 24 }, { ...settings, frequency: "hourly" }, { ...settings, keep: 0 }, {}]) {
      assert.equal((await call(app, admin, "PUT", url, bad)).json().code, "BACKUP_INVALID");
    }
    const saved = (await call(app, admin, "PUT", url, settings)).json().schedule;
    assert.equal(saved.enabled, true);
    assert.ok(new Date(saved.nextRunAt).getTime() > Date.now());

    // Right after saving, today's 02:00 is already past: nothing fires for it.
    assert.equal(await runDueBackupSchedules(new Date()), 0);

    const day = (n: number) => {
      const date = new Date();
      date.setDate(date.getDate() + n);
      date.setHours(3, 0, 0, 0);
      return date;
    };
    assert.equal(await runDueBackupSchedules(day(1)), 1);
    assert.equal(await runDueBackupSchedules(day(1)), 0, "once per occurrence");
    const first = (await list()).backups[0];
    assert.equal(first.trigger, "scheduled");
    assert.equal(first.status, "done");
    assert.equal(first.expiresAt, null, "kept by count, not by age");
    assert.equal((await list()).schedule.lastStatus, "done");
    await call(app, admin, "PATCH", `/api/admin/backups/${first.id}`, { pinned: true });

    // The server was down for days: one catch-up run, not one per missed night.
    assert.equal(await runDueBackupSchedules(day(5)), 1);
    assert.equal(await runDueBackupSchedules(day(6)), 1);
    assert.equal(await runDueBackupSchedules(day(7)), 1);
    const kept = (await list()).backups.filter((b) => b.trigger === "scheduled");
    // Two kept by the schedule, plus the pinned one, which neither counts nor goes.
    assert.equal(kept.length, 3);
    assert.ok(kept.some((b) => b.id === first.id));
    // The age-based sweep leaves scheduled backups to their schedule.
    db.prepare("UPDATE backups SET started_at = datetime(started_at, '-365 days') WHERE connection_id = ?").run(connId);
    assert.equal(purgeExpiredBackups(), 0);

    await call(app, admin, "PUT", url, { ...settings, enabled: false });
    assert.equal(await runDueBackupSchedules(day(30)), 0);
    const audited = db
      .prepare("SELECT detail FROM audit_log WHERE action = 'backup.schedule' ORDER BY rowid")
      .all() as {
      detail: string;
    }[];
    assert.deepEqual(
      audited.map((row) => row.detail),
      ["Nightly: daily at 2:00, keeping 2", "Nightly: off"],
    );
  } finally {
    closeAllRooms();
    await app.close();
  }
});
