import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NEBULADB_DB_PATH = join(tmpdir(), `nebuladb-test-bundle-${randomUUID()}.sqlite`);
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");
const { BUNDLE_FORMAT } = await import("@nebuladb/shared");

type App = Awaited<ReturnType<typeof buildApp>>;

const HOST = "localhost:3001";
const headers = (cookie?: string) => ({ host: HOST, origin: `http://${HOST}`, ...(cookie ? { cookie } : {}) });

async function makeUser(app: App, isAdmin: 0 | 1 = 0) {
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

const call = (app: App, cookie: string, method: "GET" | "PUT" | "POST", url: string, payload?: object) =>
  app.inject({ method, url, headers: headers(cookie), ...(payload ? { payload } : {}) });

const SCHEMA = `Table users {
  id int [pk, increment]
  email varchar(255) [unique, not null]
}
`;

const SEED = {
  content: "id,email\n1,a@example.com\n",
  options: { separator: ",", header: true, mapping: ["__id__", "__email__"], mode: "if-empty" },
};

async function newProject(app: App, cookie: string, name: string) {
  const { id } = (await call(app, cookie, "POST", "/api/projects", { name })).json() as { id: string };
  return id;
}

test("a bundle carries locks, seeds and generator settings, and restores them on another project", async () => {
  const app = await buildApp();
  try {
    const cookie = await makeUser(app);
    const source = await newProject(app, cookie, "Source");
    await call(app, cookie, "POST", `/api/projects/${source}/import`, { source: SCHEMA });
    const content = (await call(app, cookie, "GET", `/api/projects/${source}/content`)).json() as {
      tables: { id: string; fields: { id: string; name: string }[] }[];
    };
    const users = content.tables[0];
    const fieldId = (name: string) => users.fields.find((f) => f.name === name)!.id;

    const seed = { ...SEED, options: { ...SEED.options, mapping: [fieldId("id"), fieldId("email")] } };
    assert.equal((await call(app, cookie, "PUT", `/api/projects/${source}/seeds/${users.id}`, seed)).statusCode, 200);
    assert.equal(
      (await call(app, cookie, "PUT", `/api/projects/${source}/locks/${users.id}`, { level: "full", reason: "ref" }))
        .statusCode,
      200,
    );
    db.prepare("INSERT INTO generator_configs (project_id, table_id, config_json) VALUES (?, ?, ?)").run(
      source,
      users.id,
      JSON.stringify({ rows: 5, seed: 1, locale: "en", columns: {} }),
    );

    const exported = await call(app, cookie, "GET", `/api/projects/${source}/export/bundle`);
    assert.equal(exported.statusCode, 200, exported.body);
    const bundle = exported.json() as {
      format: string;
      dbml: string;
      locks: { level: string; reason: string }[];
      seeds: { content: string }[];
      generators: unknown[];
    };
    assert.equal(bundle.format, BUNDLE_FORMAT);
    assert.match(bundle.dbml, /Table users/);
    assert.deepEqual(
      [bundle.locks[0].level, bundle.locks[0].reason, bundle.seeds[0].content, bundle.generators.length],
      ["full", "ref", SEED.content, 1],
    );

    const target = await newProject(app, cookie, "Target");
    const imported = await call(app, cookie, "POST", `/api/projects/${target}/import/bundle`, {
      source: exported.body,
    });
    assert.equal(imported.statusCode, 200, imported.body);
    assert.deepEqual(
      { tables: 1, locks: 1, seeds: 1, generators: 1, skipped: [] },
      (({ imported: _, ...rest }) => rest)(imported.json() as Record<string, unknown>),
    );

    const again = (await call(app, cookie, "GET", `/api/projects/${target}/export/bundle`)).json() as typeof bundle;
    assert.equal(again.locks[0].level, "full");
    assert.equal(again.seeds[0].content, SEED.content);
    assert.equal(again.generators.length, 1);
  } finally {
    closeAllRooms();
    await app.close();
  }
});

test("a lock above the importer's authority is skipped, not applied; a bad bundle is refused", async () => {
  const app = await buildApp();
  try {
    const cookie = await makeUser(app);
    const id = await newProject(app, cookie, "P");
    await call(app, cookie, "POST", `/api/projects/${id}/import`, { source: SCHEMA });
    const bundle = (await call(app, cookie, "GET", `/api/projects/${id}/export/bundle`)).json() as {
      project: { tables: { id: string }[] };
      locks: unknown[];
    };
    bundle.locks = [
      { tableId: bundle.project.tables[0].id, tableName: "users", level: "structure", authority: "instance" },
    ];
    const res = await call(app, cookie, "POST", `/api/projects/${id}/import/bundle`, { source: JSON.stringify(bundle) });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual((res.json() as { locks: number; skipped: string[] }).skipped, ["lock:users"]);

    const bad = await call(app, cookie, "POST", `/api/projects/${id}/import/bundle`, { source: '{"format":"other"}' });
    assert.equal(bad.statusCode, 400);
  } finally {
    closeAllRooms();
    await app.close();
  }
});
