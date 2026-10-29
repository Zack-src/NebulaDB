import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { useTestDatabase } from "./infrastructure/testDatabase.js";

/** A collaborator writes straight into the shared document; what the SQL export makes of it. */
await useTestDatabase("sqlexportinjection");
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("./app.js");
const { db } = await import("./infrastructure/db.js");
const { hashPassword } = await import("./modules/auth/password.js");
const { getRoom, closeAllRooms } = await import("./realtime/roomRegistry.js");

const HOST = "localhost:3001";
const PASSWORD = "correct horse battery staple";
const app = await buildApp();
void after(async () => {
  await closeAllRooms();
  await app.close();
});
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `http://${HOST}`, ...extra });

async function signedIn() {
  const email = `${randomUUID()}@example.com`;
  await db
    .prepare("INSERT INTO users (id, email, password_hash, is_admin) VALUES (?, ?, ?, ?)")
    .run(randomUUID(), email, await hashPassword(PASSWORD), 0);
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password: PASSWORD },
  });
  return `nebuladb_sid=${login.cookies.find((c) => c.name === "nebuladb_sid")!.value}`;
}

async function projectWithTable(
  cookie: string,
  table: { name?: string; type?: string; default?: string; defaultKind?: string },
) {
  const created = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: headers({ cookie }),
    payload: { name: "inj" },
  });
  const id = created.json().id as string;
  const room = await getRoom(id);
  await room.write(() => {
    room.doc.getMap("tables").set("t1", {
      id: "t1",
      name: table.name ?? "orders",
      fields: [
        { id: "t1.id", name: "id", type: "int", pk: true },
        { id: "t1.a", name: "a", type: table.type ?? "text", default: table.default, defaultKind: table.defaultKind },
      ],
      indexes: [],
      position: { x: 0, y: 0 },
      detailLevel: "standard",
    });
  }, "attacker");
  return id;
}

const exportSql = (cookie: string, id: string, dialect: string) =>
  app.inject({ method: "GET", url: `/api/projects/${id}/export/sql?dialect=${dialect}`, headers: headers({ cookie }) });

test("a type, a default or a name that would add a statement to the exported SQL is refused with a 400", async () => {
  const cookie = await signedIn();
  const hostile = [
    { type: "int); DROP TABLE victims; --" },
    { default: "now(); DROP TABLE victims", defaultKind: "expression" },
    { name: 'x"; DROP TABLE victims; --' },
    { name: "x`; DROP TABLE victims; --" },
    { default: "x'; DROP TABLE victims; --" },
  ];
  for (const table of hostile) {
    const id = await projectWithTable(cookie, table);
    for (const dialect of ["postgres", "mysql", "mssql"]) {
      const res = await exportSql(cookie, id, dialect);
      assert.ok(
        res.statusCode < 500,
        `${JSON.stringify(table)} ${dialect}: ${res.statusCode} ${res.body.slice(0, 100)}`,
      );
      if (res.statusCode === 200) {
        assert.doesNotMatch(
          res.body.replace(/'[^']*'/g, "''"),
          /DROP TABLE victims/,
          `${JSON.stringify(table)} ${dialect} wrote a second statement`,
        );
      } else {
        assert.equal(res.json().code, "SQL_FRAGMENT_UNSAFE");
      }
    }
  }
});

test("ordinary types, defaults and names still export", async () => {
  const cookie = await signedIn();
  for (const table of [
    { type: "varchar(255)" },
    { type: "numeric(10,2)", default: "0", defaultKind: "number" },
    { type: "timestamptz", default: "now()", defaultKind: "expression" },
    { type: "text", default: "it's fine", defaultKind: "string" },
    { name: "order items" },
  ]) {
    const id = await projectWithTable(cookie, table);
    const res = await exportSql(cookie, id, "postgres");
    assert.equal(res.statusCode, 200, `${JSON.stringify(table)}: ${res.body.slice(0, 120)}`);
  }
});
