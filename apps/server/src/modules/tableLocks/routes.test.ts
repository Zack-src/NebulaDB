import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

process.env.ATHANORDB_DB_PATH = join(tmpdir(), `athanordb-test-tablelocks-${randomUUID()}.sqlite`);
process.env.ATHANORDB_COOKIE_SECURE = "false";
process.env.ATHANORDB_SECRET = "test-secret-do-not-use-in-production";
process.env.ATHANORDB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");

type App = Awaited<ReturnType<typeof buildApp>>;

const HOST = "localhost:3001";
const headers = (cookie?: string) => ({ host: HOST, origin: `http://${HOST}`, ...(cookie ? { cookie } : {}) });

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
  const cookie = `athanordb_sid=${res.cookies.find((c) => c.name === "athanordb_sid")!.value}`;
  return { id, email, cookie };
}

/** Grants `userId` a level on the project through a team — the only way a non-owner gets one. */
function grant(projectId: string, userId: string, permission: "view" | "edit" | "administrator") {
  const teamId = randomUUID();
  db.prepare("INSERT INTO teams (id, name) VALUES (?, ?)").run(teamId, `team-${teamId}`);
  db.prepare("INSERT INTO team_members (team_id, user_id) VALUES (?, ?)").run(teamId, userId);
  db.prepare("INSERT INTO project_teams (project_id, team_id, permission) VALUES (?, ?, ?)").run(
    projectId,
    teamId,
    permission,
  );
}

const call = (app: App, cookie: string, method: "GET" | "PUT" | "DELETE" | "POST", url: string, payload?: object) =>
  app.inject({ method, url, headers: headers(cookie), ...(payload ? { payload } : {}) });

// Deliberately exercises what DBML can express on a table — defaults of each
// kind, notes, a composite index, an inline and a standalone relation — since
// a locked table has to come back from the DBML round trip *unchanged* for
// the editor's own sync not to be refused.
const SCHEMA = `Table users {
  id int [pk, increment]
  email varchar(255) [unique, not null, note: 'login']
  status varchar [default: 'active']
  score int [default: 0]
  created_at timestamp [default: \`now()\`]
  note: 'accounts'

  indexes {
    (email, status) [unique, name: 'uq_users_email_status']
  }
}

Table orders {
  id int [pk]
  user_id int [ref: > users.id]
  total decimal(10,2)
}

Table items {
  id int [pk]
  order_id int
}

Ref: items.order_id > orders.id [delete: cascade]
`;

/**
 * Edits exported DBML, which pads columns into alignment — so a plain string
 * replace of "email varchar(255)" silently matches nothing. Throws rather than
 * let a test "pass" on an edit that never happened.
 */
function edit(source: string, pattern: RegExp, replacement: string): string {
  const edited = source.replace(pattern, replacement);
  assert.notEqual(edited, source, `edit ${pattern} matched nothing`);
  return edited;
}

const EMAIL_TO_TEXT = [/email(\s+)varchar\(255\)/, "email$1text"] as const;

async function projectWithSchema(app: App, ownerCookie: string) {
  const created = await call(app, ownerCookie, "POST", "/api/projects", { name: "Locks" });
  const { id } = created.json() as { id: string };
  const imported = await call(app, ownerCookie, "POST", `/api/projects/${id}/import`, { source: SCHEMA });
  assert.equal(imported.statusCode, 200, imported.body);
  const content = (await call(app, ownerCookie, "GET", `/api/projects/${id}/content`)).json() as {
    tables: { id: string; name: string }[];
  };
  const tableId = (name: string) => content.tables.find((table) => table.name === name)!.id;
  const dbml = async (cookie = ownerCookie) =>
    (await call(app, cookie, "GET", `/api/projects/${id}/export/dbml`)).body as string;
  return { id, tableId, dbml };
}

test("who may lock: administrators of the project, not editors or viewers; everyone with access may read", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser(app);
    const editor = await makeUser(app);
    const viewer = await makeUser(app);
    const outsider = await makeUser(app);
    const teamAdmin = await makeUser(app);
    const project = await projectWithSchema(app, owner.cookie);
    grant(project.id, editor.id, "edit");
    grant(project.id, viewer.id, "view");
    grant(project.id, teamAdmin.id, "administrator");
    const url = `/api/projects/${project.id}/locks`;
    const usersUrl = `${url}/${project.tableId("users")}`;

    for (const user of [editor, viewer]) {
      assert.equal((await call(app, user.cookie, "PUT", usersUrl, { level: "structure" })).statusCode, 403);
    }
    assert.equal((await call(app, outsider.cookie, "GET", url)).statusCode, 403);

    assert.equal((await call(app, owner.cookie, "PUT", usersUrl, { level: "nope" })).statusCode, 400);
    assert.equal((await call(app, owner.cookie, "PUT", `${url}/no-such-table`, { level: "full" })).statusCode, 404);

    const locked = await call(app, owner.cookie, "PUT", usersUrl, { level: "structure", reason: "  HR reference  " });
    assert.equal(locked.statusCode, 200, locked.body);
    assert.equal(locked.json().reason, "HR reference");
    assert.equal(locked.json().authority, "project");

    const seenByViewer = (await call(app, viewer.cookie, "GET", url)).json();
    assert.equal(seenByViewer.canManage, null);
    assert.deepEqual(
      seenByViewer.locks.map((lock: { tableName: string; level: string }) => [lock.tableName, lock.level]),
      [["users", "structure"]],
    );
    assert.equal((await call(app, owner.cookie, "GET", url)).json().canManage, "project");

    assert.equal((await call(app, editor.cookie, "DELETE", usersUrl)).statusCode, 403);
    // Any project administrator can lift a project-level lock, not only whoever placed it.
    assert.equal((await call(app, teamAdmin.cookie, "DELETE", usersUrl)).statusCode, 200);
    assert.equal((await call(app, owner.cookie, "DELETE", usersUrl)).statusCode, 404);

    const actions = (
      db
        .prepare("SELECT action, detail FROM audit_log WHERE target_id = ? AND action LIKE 'table.%'")
        .all(project.id) as {
        action: string;
        detail: string;
      }[]
    ).map((row) => `${row.action}: ${row.detail}`);
    assert.deepEqual(actions, ["table.lock: users (structure, project)", "table.unlock: users"]);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("an instance-level lock is out of a project administrator's reach, including for editing the table", async () => {
  const app = await buildApp();
  try {
    const instanceAdmin = await makeUser(app, 1);
    const owner = await makeUser(app);
    const project = await projectWithSchema(app, owner.cookie);
    const usersUrl = `/api/projects/${project.id}/locks/${project.tableId("users")}`;

    // A project administrator cannot place one…
    const tried = await call(app, owner.cookie, "PUT", usersUrl, { level: "full", authority: "instance" });
    assert.equal(tried.statusCode, 403);
    assert.equal(tried.json().code, "TABLE_LOCK_FORBIDDEN");

    assert.equal(
      (await call(app, instanceAdmin.cookie, "PUT", usersUrl, { level: "full", authority: "instance" })).statusCode,
      200,
    );
    // …nor downgrade it, lift it, or change the table under it.
    for (const attempt of [
      call(app, owner.cookie, "PUT", usersUrl, { level: "structure" }),
      call(app, owner.cookie, "DELETE", usersUrl),
    ]) {
      assert.equal((await attempt).json().code, "TABLE_LOCK_FORBIDDEN");
    }
    const edited = edit(await project.dbml(), ...EMAIL_TO_TEXT);
    const refused = await call(app, owner.cookie, "POST", `/api/projects/${project.id}/import`, { source: edited });
    assert.equal(refused.statusCode, 403);
    assert.deepEqual(refused.json().tables, ["users"]);

    const allowed = await call(app, instanceAdmin.cookie, "POST", `/api/projects/${project.id}/import`, {
      source: edited,
    });
    assert.equal(allowed.statusCode, 200, allowed.body);
    assert.equal(
      (await call(app, owner.cookie, "GET", `/api/projects/${project.id}/locks`)).json().canManage,
      "project",
    );
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("import: an editor's change is refused whole when it touches a locked table, and goes through when it does not", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser(app);
    const editor = await makeUser(app);
    const project = await projectWithSchema(app, owner.cookie);
    grant(project.id, editor.id, "edit");
    const importUrl = `/api/projects/${project.id}/import`;
    for (const name of ["users", "orders"]) {
      const res = await call(app, owner.cookie, "PUT", `/api/projects/${project.id}/locks/${project.tableId(name)}`, {
        level: "structure",
      });
      assert.equal(res.statusCode, 200);
    }
    const original = await project.dbml();

    // The DBML editor re-sends the whole buffer on every sync: a buffer in
    // which the locked tables are untouched must never be refused.
    const unchanged = await call(app, editor.cookie, "POST", importUrl, { source: original, baseline: original });
    assert.equal(unchanged.statusCode, 200, unchanged.body);

    const elsewhere = edit(original, /order_id(\s+)int/, "order_id$1bigint");
    assert.equal((await call(app, editor.cookie, "POST", importUrl, { source: elsewhere })).statusCode, 200);
    assert.match(await project.dbml(), /order_id\s+bigint/);

    // One allowed change and two forbidden ones in the same buffer: nothing is applied.
    const before = await project.dbml();
    const mixed = edit(
      edit(edit(before, /order_id(\s+)bigint/, "order_id$1int"), ...EMAIL_TO_TEXT),
      /total(\s+)decimal\(10,2\)/,
      "total$1decimal(12,4)",
    );
    const refused = await call(app, editor.cookie, "POST", importUrl, { source: mixed });
    assert.equal(refused.statusCode, 403);
    assert.equal(refused.json().code, "TABLE_LOCKED");
    assert.deepEqual(refused.json().tables.sort(), ["orders", "users"]);
    assert.equal(await project.dbml(), before, "rejected whole — the allowed part did not go through either");

    // Dropping a locked table, and dropping the foreign key it carries, are refused too.
    await call(app, owner.cookie, "PUT", `/api/projects/${project.id}/locks/${project.tableId("items")}`, {
      level: "full",
    });
    const withoutItems = edit(edit(before, /Table items \{[^}]*\}\n/, ""), /^Ref: items\.[^\n]*\n/m, "");
    const dropRefused = await call(app, editor.cookie, "POST", importUrl, { source: withoutItems });
    assert.equal(dropRefused.statusCode, 403, dropRefused.body);
    assert.deepEqual(dropRefused.json().tables, ["items"]);
    const withoutFk = edit(before, /^Ref: orders\.user_id > users\.id\n/m, "");
    const fkRefused = await call(app, editor.cookie, "POST", importUrl, { source: withoutFk });
    assert.deepEqual(fkRefused.json().tables, ["orders"]);

    // Same rule on the public API.
    const v1 = await call(app, editor.cookie, "POST", `/api/v1/projects/${project.id}/import`, { source: mixed });
    assert.equal(v1.json().code, "TABLE_LOCKED");

    // The project's administrator is not bound by a project-level lock.
    assert.equal((await call(app, owner.cookie, "POST", importUrl, { source: mixed })).statusCode, 200);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("history restore is refused when it would change a locked table; deleting the project drops its locks", async () => {
  const app = await buildApp();
  try {
    const owner = await makeUser(app);
    const editor = await makeUser(app);
    const project = await projectWithSchema(app, owner.cookie);
    grant(project.id, editor.id, "edit");
    const base = `/api/projects/${project.id}`;

    const revisions = (await call(app, owner.cookie, "GET", `${base}/revisions`)).json() as { id: string }[];
    assert.ok(revisions.length > 0);
    const firstRevision = revisions[revisions.length - 1].id;

    // Move on from that revision, then lock the table that changed.
    const changed = edit(await project.dbml(), /email(\s+)varchar\(255\)/, "email$1varchar(320)");
    assert.equal((await call(app, owner.cookie, "POST", `${base}/import`, { source: changed })).statusCode, 200);
    await call(app, owner.cookie, "PUT", `${base}/locks/${project.tableId("users")}`, { level: "structure" });

    const refused = await call(app, editor.cookie, "POST", `${base}/revisions/${firstRevision}/restore`);
    assert.equal(refused.statusCode, 403);
    assert.equal(refused.json().code, "TABLE_LOCKED");
    assert.match(await project.dbml(), /varchar\(320\)/);

    assert.equal((await call(app, owner.cookie, "POST", `${base}/revisions/${firstRevision}/restore`)).statusCode, 200);

    assert.equal((await call(app, owner.cookie, "DELETE", base)).statusCode, 200);
    const left = db.prepare("SELECT COUNT(*) AS n FROM table_locks WHERE project_id = ?").get(project.id) as {
      n: number;
    };
    assert.equal(left.n, 0);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("pull from a database: relations follow their tables, and a pull that alters a locked table is refused", async () => {
  const app = await buildApp();
  try {
    const instanceAdmin = await makeUser(app, 1);
    const owner = await makeUser(app);
    const created = await call(app, owner.cookie, "POST", "/api/projects", { name: "Pulled" });
    const { id } = created.json() as { id: string };
    const base = `/api/projects/${id}`;

    const file = join(tmpdir(), `athanordb-test-lockpull-${randomUUID()}.sqlite`);
    const target = new Database(file);
    target.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL);
      CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id));
    `);

    const conn = await call(app, owner.cookie, "POST", `${base}/connections`, {
      name: "Local file",
      engine: "sqlite",
      filePath: file,
    });
    assert.equal(conn.statusCode, 200, conn.body);
    const pullUrl = `${base}/connections/${conn.json().connection.id}/pull`;
    const content = async () =>
      (await call(app, owner.cookie, "GET", `${base}/content`)).json() as {
        tables: { id: string; name: string; fields: { name: string }[] }[];
        refs: { from: { tableId: string }; to: { tableId: string } }[];
      };

    // Twice: the second pull merges into tables that already have their own ids.
    for (let round = 0; round < 2; round++) {
      assert.equal((await call(app, owner.cookie, "POST", pullUrl)).statusCode, 200);
      const project = await content();
      const ids = new Map(project.tables.map((table) => [table.name, table.id]));
      assert.equal(project.refs.length, 1);
      assert.equal(project.refs[0].from.tableId, ids.get("orders"), `round ${round}: the relation starts at orders`);
      assert.equal(project.refs[0].to.tableId, ids.get("users"), `round ${round}: and points at users`);
    }

    const usersId = (await content()).tables.find((table) => table.name === "users")!.id;
    const lock = await call(app, instanceAdmin.cookie, "PUT", `${base}/locks/${usersId}`, {
      level: "structure",
      authority: "instance",
    });
    assert.equal(lock.statusCode, 200, lock.body);

    // The database is unchanged: pulling again alters nothing, so the lock has nothing to object to.
    assert.equal((await call(app, owner.cookie, "POST", pullUrl)).statusCode, 200);

    target.exec("ALTER TABLE users ADD COLUMN phone TEXT");
    target.close();
    const refused = await call(app, owner.cookie, "POST", pullUrl);
    assert.equal(refused.statusCode, 403, refused.body);
    assert.deepEqual(refused.json().tables, ["users"]);
    assert.ok(
      !(await content()).tables.find((table) => table.name === "users")!.fields.some((f) => f.name === "phone"),
    );

    assert.equal((await call(app, instanceAdmin.cookie, "POST", pullUrl)).statusCode, 200);
    assert.ok((await content()).tables.find((table) => table.name === "users")!.fields.some((f) => f.name === "phone"));
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("/api/v1 locks: listed, placed and lifted by table name with an API key, under the same rules and scopes", async () => {
  const app = await buildApp();
  try {
    const instanceAdmin = await makeUser(app, 1);
    const owner = await makeUser(app);
    const editor = await makeUser(app);
    const project = await projectWithSchema(app, owner.cookie);
    grant(project.id, editor.id, "edit");
    const key = async (cookie: string, scopes: string[]) =>
      (await call(app, cookie, "POST", "/api/keys", { name: "locks", scopes })).json().plaintextKey as string;
    const withKey = (plaintext: string, method: "GET" | "PUT" | "DELETE", url: string, payload?: unknown) =>
      app.inject({
        method,
        url,
        headers: { host: "localhost:3001", authorization: `Bearer ${plaintext}` },
        ...(payload === undefined ? {} : { payload: payload as object }),
      });
    const writeKey = await key(owner.cookie, ["projects:read", "projects:write"]);
    const readKey = await key(owner.cookie, ["projects:read"]);
    const editorKey = await key(editor.cookie, ["projects:read", "projects:write"]);
    const url = `/api/v1/projects/${project.id}/locks`;

    // A read scope lists and nothing more; an editor's key is no administrator's.
    assert.equal((await withKey(readKey, "PUT", `${url}/users`, { level: "structure" })).statusCode, 403);
    assert.equal((await withKey(editorKey, "PUT", `${url}/users`, { level: "structure" })).statusCode, 403);
    assert.equal((await withKey(writeKey, "PUT", `${url}/no_such_table`, { level: "full" })).statusCode, 404);
    assert.equal((await withKey(writeKey, "PUT", `${url}/users`, { level: "frozen" })).statusCode, 400);

    // By name, whatever its case — and by id.
    const locked = await withKey(writeKey, "PUT", `${url}/USERS`, { level: "structure", reason: "reference" });
    assert.equal(locked.statusCode, 200, locked.body);
    assert.equal(locked.json().tableId, project.tableId("users"));
    assert.equal(locked.json().tableName, "users");
    const changed = await withKey(writeKey, "PUT", `${url}/${project.tableId("users")}`, { level: "full" });
    assert.equal(changed.json().level, "full");

    const listed = (await withKey(readKey, "GET", url)).json();
    assert.equal(listed.canManage, "project");
    assert.deepEqual(
      listed.locks.map((lock: { tableName: string; level: string; reason: string | null }) => [
        lock.tableName,
        lock.level,
        lock.reason,
      ]),
      [["users", "full", null]],
    );
    // The lock placed through the API is the one the app enforces.
    const refused = await call(app, editor.cookie, "POST", `/api/projects/${project.id}/import`, {
      source: (await project.dbml()).replace(...EMAIL_TO_TEXT),
    });
    assert.equal(refused.json().code, "TABLE_LOCKED");

    // An instance lock stays out of a project administrator's reach here too.
    const instanceLock = await call(app, instanceAdmin.cookie, "PUT", `${url}/users`, {
      level: "structure",
      authority: "instance",
    });
    assert.equal(instanceLock.statusCode, 200, instanceLock.body);
    assert.equal((await withKey(writeKey, "DELETE", `${url}/users`)).json().code, "TABLE_LOCK_FORBIDDEN");
    assert.equal((await call(app, instanceAdmin.cookie, "DELETE", `${url}/users`)).statusCode, 200);
    assert.equal((await withKey(writeKey, "DELETE", `${url}/users`)).statusCode, 404);
    assert.deepEqual((await withKey(readKey, "GET", url)).json().locks, []);
  } finally {
    closeAllRooms();
    await app.close();
  }
});
