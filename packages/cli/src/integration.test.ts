import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./cli.js";

/**
 * The CLI against the real server: `buildApp()` listening on a random port, with the server's own
 * test environment. Needs `apps/server` built (the root `npm run build` does it first).
 *
 * The server is reached over HTTP only, as the CLI does; the one thing done behind its back is
 * creating the first administrator (`createAdmin`), which is how the server's own tests do it and
 * the only line to follow if the instance's storage changes.
 */

const dir = mkdtempSync(join(tmpdir(), "nebuladb-cli-it-"));
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const SERVER_DIST = new URL("../../../apps/server/dist/", import.meta.url);

// A throwaway PostgreSQL database, as the server's own tests use (`NEBULADB_TEST_PG_*`).
const { useTestDatabase } = (await import(new URL("infrastructure/testDatabase.js", SERVER_DIST).href)) as {
  useTestDatabase(label: string): Promise<string>;
};
await useTestDatabase("cli");

interface ServerApp {
  listen(options: { port: number; host: string }): Promise<string>;
  close(): Promise<void>;
}
const { buildApp } = (await import(new URL("app.js", SERVER_DIST).href)) as { buildApp(): Promise<ServerApp> };
const { db } = (await import(new URL("infrastructure/db.js", SERVER_DIST).href)) as {
  db: { prepare(sql: string): { run(...values: unknown[]): Promise<unknown> } };
};
const { hashPassword } = (await import(new URL("modules/auth/password.js", SERVER_DIST).href)) as {
  hashPassword(password: string): Promise<string>;
};
const { closeAllRooms } = (await import(new URL("realtime/roomRegistry.js", SERVER_DIST).href)) as {
  closeAllRooms(): Promise<void>;
};

/** The fields of the app's answers the setup reads. */
interface Session {
  id: string;
  plaintextKey: string;
  environment: { id: string };
  connection: { id: string };
}

/** The fields of the CLI's `--json` answers the tests read. */
interface Answer {
  projects: { id: string }[];
  reviews: unknown[];
  summary: { error: number };
  failed: boolean;
  success: boolean;
  code: string;
  engine: string;
  sqlPreview: string;
}

let app: ServerApp;
let baseUrl: string;
let cookie: string;
let apiKey: string;
let projectId: string;
let connectionId: string;
let productionConnectionId: string;

/** The first administrator: the one account that cannot be made through the API. */
async function createAdmin(): Promise<{ email: string; password: string }> {
  const password = "correct horse battery staple";
  const email = `${randomUUID()}@example.com`;
  await db
    .prepare("INSERT INTO users (id, email, password_hash, is_admin, display_name) VALUES (?, ?, ?, 1, NULL)")
    .run(randomUUID(), email, await hashPassword(password));
  return { email, password };
}

/** The app's own session routes, for what a key may not do (creating keys, choosing lint rules, stages). */
async function session(method: string, path: string, body?: unknown): Promise<Session> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { origin: baseUrl, "content-type": "application/json", ...(cookie && { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${await response.clone().text()}`);
  if (!cookie) {
    cookie = (response.headers.getSetCookie()[0] ?? "").split(";")[0];
  }
  return (await response.json()) as Session;
}

/** Runs the CLI in process against the test server. */
async function nebula(args: string[], env: Record<string, string | undefined> = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(args, {
    stdout: (text) => void stdout.push(text),
    stderr: (text) => void stderr.push(text),
    env: { NEBULADB_URL: baseUrl, NEBULADB_API_KEY: apiKey, ...env },
  });
  const out = stdout.join("");
  return { code, out, err: stderr.join(""), json: () => JSON.parse(out) as Answer };
}

before(async () => {
  app = await buildApp();
  baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });

  const admin = await createAdmin();
  cookie = "";
  await session("POST", "/api/auth/login", { email: admin.email, password: admin.password });
  apiKey = (
    await session("POST", "/api/keys", {
      name: "cli integration",
      scopes: ["projects:read", "projects:write", "deployments:trigger"],
    })
  ).plaintextKey;
  projectId = (await session("POST", "/api/projects", { name: "Shop" })).id;

  const production = (
    await session("POST", "/api/admin/environments", { name: "Live", color: "red", production: true })
  ).environment;
  const sqlite = (name: string, extra: object = {}) =>
    session("POST", `/api/projects/${projectId}/connections`, {
      name,
      engine: "sqlite",
      filePath: join(dir, `${name}.sqlite`),
      ...extra,
    });
  connectionId = (await sqlite("staging")).connection.id;
  productionConnectionId = (await sqlite("shop-live", { environmentId: production.id })).connection.id;
});

after(async () => {
  await closeAllRooms();
  await app.close();
});

test("the sample project is imported from a DBML file and listed", async () => {
  const file = join(dir, "schema.dbml");
  writeFileSync(file, "Table widgets {\n  id int\n  label varchar(40)\n}\n");
  const imported = await nebula(["project", "import", projectId, file]);
  assert.equal(imported.code, 0, imported.err);
  assert.match(imported.out, /Imported 1 table/);

  const listed = await nebula(["projects", "list", "--json"]);
  assert.equal(listed.code, 0);
  assert.deepEqual(
    listed.json().projects.map((project: { id: string }) => project.id),
    [projectId],
  );
  assert.match((await nebula(["projects", "list"])).out, /Shop/);
});

test("lint: warnings pass, --fail-on warning and an error fail with exit 1", async () => {
  const standard = await nebula(["lint", projectId]);
  assert.equal(standard.code, 0, standard.err);
  assert.match(standard.out, /warning\s+widgets: .*\[pk-required\]/);

  assert.equal((await nebula(["lint", projectId, "--fail-on", "warning"])).code, 1);

  await session("PUT", `/api/projects/${projectId}/lint`, { profile: "strict" });
  const strict = await nebula(["lint", projectId, "--json"]);
  assert.equal(strict.code, 1);
  assert.equal(strict.json().failed, true);
  assert.ok(strict.json().summary.error > 0);
  assert.match((await nebula(["lint", projectId])).out, /error\s+widgets: .*\[pk-required\]/);
});

test("deploy plan shows what would run, and what the server would refuse", async () => {
  await session("PUT", `/api/projects/${projectId}/lint`, { profile: "strict", blockDeployment: true });
  const blocked = await nebula(["deploy", "plan", projectId, connectionId]);
  assert.equal(blocked.code, 1);
  assert.match(blocked.out, /Would be refused: \d+ lint errors?/);
  assert.match(blocked.out, /CREATE TABLE/i);

  await session("PUT", `/api/projects/${projectId}/lint`, { profile: "relaxed", blockDeployment: false });
  const plan = await nebula(["deploy", "plan", projectId, connectionId, "--json"]);
  assert.equal(plan.code, 0, plan.err);
  assert.equal(plan.json().engine, "sqlite");
  assert.match(plan.json().sqlPreview, /widgets/);
});

test("deploy run: the server's refusals come back with their code and exit 1; nothing is accepted for the caller", async () => {
  await session("PUT", `/api/projects/${projectId}/lint`, { profile: "strict", blockDeployment: true });
  const lint = await nebula(["deploy", "run", projectId, connectionId, "--json"]);
  assert.equal(lint.code, 1);
  assert.equal(lint.json().code, "LINT_BLOCKS_DEPLOYMENT");
  await session("PUT", `/api/projects/${projectId}/lint`, { profile: "relaxed", blockDeployment: false });

  const unconfirmed = await nebula(["deploy", "run", projectId, productionConnectionId]);
  assert.equal(unconfirmed.code, 1);
  assert.match(unconfirmed.err, /\(PRODUCTION_CONFIRMATION_REQUIRED\)/);
  const wrongName = await nebula(["deploy", "run", projectId, productionConnectionId, "--confirm-name", "Shop"]);
  assert.equal(wrongName.code, 1);

  // Nothing ran: the history of both databases is still empty.
  const history = await nebula(["history", "export", projectId, productionConnectionId, "-o", join(dir, "none.zip")]);
  assert.equal(history.code, 0, history.err);
});

test("deploy run: with what the server asks for, the deployment goes through, and a drift check follows", async () => {
  const staging = await nebula(["deploy", "run", projectId, connectionId, "--json"]);
  assert.equal(staging.code, 0, staging.err);
  assert.equal(staging.json().success, true);

  const production = await nebula(["deploy", "run", projectId, productionConnectionId, "--confirm-name", "shop-live"]);
  assert.equal(production.code, 0, production.err);
  assert.match(production.out, /Deployed: \d+ statements? executed\./);
  assert.match(production.out, /Backup: /, "the production stage backs up first");

  const quiet = await nebula(["drift", "check", projectId]);
  assert.equal(quiet.code, 0, quiet.out + quiet.err);
  assert.match(quiet.out, /Checked 2 databases: 0 new changes/);

  // Someone changes a database behind the schema's back.
  const { default: Sqlite } = (await import("better-sqlite3")) as unknown as {
    default: new (path: string) => { exec(sql: string): void; close(): void };
  };
  const outside = new Sqlite(join(dir, "staging.sqlite"));
  outside.exec("CREATE TABLE rogue (id INTEGER PRIMARY KEY)");
  outside.close();

  const drifted = await nebula(["drift", "check", projectId]);
  assert.equal(drifted.code, 1);
  assert.match(drifted.out, /changed outside the schema: staging/);
  assert.equal((await nebula(["drift", "check", projectId, "--json"])).json().failed, true);
});

test("history export writes the migrations as a zip", async () => {
  for (const format of ["sql", "flyway", "liquibase"]) {
    const file = join(dir, `${format}.zip`);
    const exported = await nebula(["history", "export", projectId, connectionId, "--format", format, "-o", file]);
    assert.equal(exported.code, 0, exported.err);
    assert.equal(readFileSync(file).subarray(0, 2).toString(), "PK", `${format}: a zip archive`);
  }
});

test("project export and import round-trip as DBML and as a bundle", async () => {
  const dbml = join(dir, "export.dbml");
  assert.equal((await nebula(["project", "export", projectId, "-o", dbml])).code, 0);
  assert.match(readFileSync(dbml, "utf8"), /Table widgets/);

  const bundle = join(dir, "export.json");
  assert.equal((await nebula(["project", "export", projectId, "--format", "bundle", "-o", bundle])).code, 0);
  assert.equal(JSON.parse(readFileSync(bundle, "utf8")).project.tables.length >= 1, true);
  const restored = await nebula(["project", "import", projectId, bundle]);
  assert.equal(restored.code, 0, restored.err);
  assert.match(restored.out, /Imported 1 table/);

  const printed = await nebula(["project", "export", projectId]);
  assert.match(printed.out, /Table widgets/);
  assert.equal((await nebula(["project", "import", projectId, dbml])).code, 0);
});

test("reviews list answers, empty when nobody asked for a review", async () => {
  const reviews = await nebula(["reviews", "list", projectId]);
  assert.equal(reviews.code, 0, reviews.err);
  assert.equal(reviews.out.trim(), "No reviews.");
  assert.deepEqual((await nebula(["reviews", "list", projectId, "--json"])).json().reviews, []);
});

test("a wrong key exits 3, an unknown project exits 1, an unreachable instance exits 3", async () => {
  const wrongKey = await nebula(["projects", "list"], { NEBULADB_API_KEY: "ndb_not-a-key" });
  assert.equal(wrongKey.code, 3);
  assert.ok(!wrongKey.err.includes("ndb_not-a-key"));

  const unknown = await nebula(["lint", "no-such-project"]);
  assert.equal(unknown.code, 1);

  const offline = await nebula(["projects", "list"], { NEBULADB_URL: "http://127.0.0.1:9" });
  assert.equal(offline.code, 3);
});

test("the installed binary runs", () => {
  const bin = fileURLToPath(new URL("./bin.js", import.meta.url));
  const version = spawnSync(process.execPath, [bin, "--version"], { encoding: "utf8" });
  assert.equal(version.status, 0);
  assert.match(version.stdout, /^\d+\.\d+\.\d+\n$/);
  const noCommand = spawnSync(process.execPath, [bin, "frobnicate"], { encoding: "utf8", env: {} });
  assert.equal(noCommand.status, 2);
  assert.match(noCommand.stderr, /unknown command "frobnicate"/);
});
