import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

process.env.NEBULADB_DB_PATH = join(tmpdir(), `nebuladb-test-compare-${randomUUID()}.sqlite`);
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");

const HOST = "localhost:3001";
type App = Awaited<ReturnType<typeof buildApp>>;
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `http://${HOST}`, ...extra });

async function login(app: App) {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, 0, NULL)").run(
    id,
    email,
    await hashPassword(password),
  );
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password },
  });
  return { id, cookie: `nebuladb_sid=${res.cookies.find((c) => c.name === "nebuladb_sid")!.value}` };
}

const call = (app: App, cookie: string, method: "GET" | "POST", url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: headers({ cookie }),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

test("compare: two of a project's databases, table by table, with what the schema does not model", async () => {
  const app = await buildApp();
  try {
    const owner = await login(app);
    const editor = await login(app);
    const project = (await call(app, owner.cookie, "POST", "/api/projects", { name: "Shop" })).json() as { id: string };
    const base = `/api/projects/${project.id}`;
    await call(app, owner.cookie, "POST", `${base}/import`, {
      source: "Table customers {\n  id integer [pk]\n  email varchar(320)\n}\n\nTable orders {\n  id integer [pk]\n}\n",
    });
    const teamId = randomUUID();
    db.prepare("INSERT INTO teams (id, name) VALUES (?, ?)").run(teamId, `team-${teamId}`);
    db.prepare("INSERT INTO team_members (team_id, user_id) VALUES (?, ?)").run(teamId, editor.id);
    db.prepare("INSERT INTO project_teams (project_id, team_id, permission) VALUES (?, ?, 'edit')").run(
      project.id,
      teamId,
    );

    const dir = mkdtempSync(join(tmpdir(), "nebuladb-compare-"));
    const database = (name: string, ddl: string) => {
      const file = join(dir, `${name}.sqlite`);
      const handle = new Database(file);
      handle.exec(ddl);
      handle.close();
      return file;
    };
    // Pre-production has what the schema says; production is one deployment behind and carries a table nobody modelled.
    const preprod = database(
      "preprod",
      "CREATE TABLE customers (id INTEGER PRIMARY KEY, email VARCHAR(320)); CREATE TABLE orders (id INTEGER PRIMARY KEY);",
    );
    const prod = database(
      "prod",
      "CREATE TABLE customers (id INTEGER PRIMARY KEY, email VARCHAR(255), fax TEXT); CREATE TABLE old_export (id INTEGER);",
    );
    const connect = async (name: string, filePath: string) =>
      (await call(app, owner.cookie, "POST", `${base}/connections`, { name, engine: "sqlite", filePath })).json()
        .connection.id as string;
    const sourceId = await connect("PreProd", preprod);
    const targetId = await connect("Prod", prod);
    const compare = (cookie: string, body: unknown) => call(app, cookie, "POST", `${base}/connections/compare`, body);

    const res = await compare(owner.cookie, { sourceId, targetId });
    assert.equal(res.statusCode, 200, res.body);
    const comparison = res.json();
    assert.equal(comparison.source.name, "PreProd");
    assert.equal(comparison.target.name, "Prod");
    assert.deepEqual(
      comparison.tables.map((t: { name: string; status: string; inSchema: boolean }) => [t.name, t.status, t.inSchema]),
      [
        ["customers", "different", true],
        ["old_export", "only-target", false],
        ["orders", "only-source", true],
      ],
    );
    assert.deepEqual(comparison.tables[0].detail.columnsAdded, ["fax"]);
    assert.deepEqual(comparison.tables[0].detail.columnsChanged, [
      { name: "email", before: "varchar(320)", after: "varchar(255)" },
    ]);

    // The same database twice has nothing to say; neither has a connection of another project.
    assert.equal((await compare(owner.cookie, { sourceId, targetId: sourceId })).json().code, "COMPARISON_INVALID");
    assert.equal((await compare(owner.cookie, { sourceId })).json().code, "COMPARISON_INVALID");
    assert.equal((await compare(owner.cookie, { sourceId, targetId: "nope" })).json().code, "CONNECTION_NOT_FOUND");
    // It opens two databases: not for an editor.
    assert.equal((await compare(editor.cookie, { sourceId, targetId })).statusCode, 403);

    // Brought level, the two are identical.
    const handle = new Database(prod);
    handle.exec(
      "DROP TABLE customers; DROP TABLE old_export; CREATE TABLE customers (id INTEGER PRIMARY KEY, email VARCHAR(320)); CREATE TABLE orders (id INTEGER PRIMARY KEY);",
    );
    handle.close();
    assert.deepEqual((await compare(owner.cookie, { sourceId, targetId })).json().tables, []);
  } finally {
    closeAllRooms();
    await app.close();
  }
});
