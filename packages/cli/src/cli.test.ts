import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, type Io } from "./cli.js";
import type { FetchLike } from "./client.js";

const KEY = "ndb_unit-test-key-0123456789";
const URL = "http://localhost:3001";

interface Call {
  url: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

function harness(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const call: Call = {
      url: input,
      method: init?.method ?? "GET",
      authorization: new Headers(init?.headers).get("authorization"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return answer(call);
  };
  const io: Io = {
    stdout: (text) => void stdout.push(text),
    stderr: (text) => void stderr.push(text),
    env: { NEBULADB_URL: URL, NEBULADB_API_KEY: KEY },
    fetch: fetchImpl,
  };
  return { io, calls, out: () => stdout.join(""), err: () => stderr.join("") };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("projects list: calls the route with the key as a Bearer token and prints a table", async () => {
  const h = harness(() => json({ projects: [{ id: "p1", name: "Shop", permission: "view" }] }));
  assert.equal(await run(["projects", "list"], h.io), 0);
  assert.deepEqual(
    h.calls.map((call) => [call.method, call.url, call.authorization]),
    [["GET", `${URL}/api/v1/projects`, `Bearer ${KEY}`]],
  );
  assert.match(h.out(), /p1 {2}Shop {2}view/);
  assert.equal(h.err(), "");
});

test("--json prints the data alone, and --json-file keeps a copy while the text output stays", async () => {
  const projects = { projects: [{ id: "p1", name: "Shop", permission: "view" }] };
  const h = harness(() => json(projects));
  assert.equal(await run(["projects", "list", "--json"], h.io), 0);
  assert.deepEqual(JSON.parse(h.out()), projects);

  const dir = mkdtempSync(join(tmpdir(), "nebuladb-cli-"));
  const file = join(dir, "result.json");
  const again = harness(() => json(projects));
  assert.equal(await run(["projects", "list", "--json-file", file], again.io), 0);
  assert.match(again.out(), /Shop/);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), projects);
});

test("lint: exit 1 on errors, 0 on warnings alone unless --fail-on warning", async () => {
  const report = (error: number, warning: number) =>
    json({
      profile: "standard",
      blockDeployment: false,
      summary: { error, warning, info: 0 },
      findings: [],
    });
  assert.equal(await run(["lint", "p1"], harness(() => report(1, 0)).io), 1);
  assert.equal(await run(["lint", "p1"], harness(() => report(0, 3)).io), 0);
  assert.equal(await run(["lint", "p1", "--fail-on", "warning"], harness(() => report(0, 3)).io), 1);
  assert.equal(await run(["lint", "p1", "--fail-on", "warning"], harness(() => report(0, 0)).io), 0);
});

test("drift check: new changes, changes still open and unreachable databases all fail", async () => {
  const check = (changes: number, unreachable: number, events: unknown[] = []) =>
    json({ result: { checked: 1, changes, unreachable }, events });
  const open = {
    id: "e",
    connectionName: "Db",
    kind: "external",
    status: "open",
    added: [],
    removed: [],
    changed: ["t"],
    error: null,
  };
  assert.equal(await run(["drift", "check", "p1"], harness(() => check(0, 0)).io), 0);
  assert.equal(await run(["drift", "check", "p1"], harness(() => check(1, 0)).io), 1);
  assert.equal(await run(["drift", "check", "p1"], harness(() => check(0, 0, [open])).io), 1);
  assert.equal(await run(["drift", "check", "p1"], harness(() => check(0, 1)).io), 1);
  assert.equal(await run(["drift", "check", "p1", "--ignore-unreachable"], harness(() => check(0, 1)).io), 0);
});

test("deploy run: sends the confirmation and the resolutions file as given, nothing else, and refuses nothing on its own", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nebuladb-cli-"));
  const resolutions = join(dir, "resolutions.json");
  writeFileSync(resolutions, JSON.stringify({ "column:users.legacy": { strategy: "DROP_DATA_CONFIRMED" } }));
  const h = harness(() => json({ success: true, executedStatements: 3, backupId: "b1" }));
  const code = await run(
    ["deploy", "run", "p1", "c1", "--confirm-name", "Shop live", "--resolutions", resolutions, "--no-backup"],
    h.io,
  );
  assert.equal(code, 0);
  assert.equal(h.calls[0].url, `${URL}/api/v1/projects/p1/connections/c1/deploy`);
  assert.deepEqual(h.calls[0].body, {
    resolutions: { "column:users.legacy": { strategy: "DROP_DATA_CONFIRMED" } },
    confirmName: "Shop live",
    backupBefore: false,
  });
  assert.match(h.out(), /Deployed: 3 statements executed\.\nBackup: b1/);

  const bare = harness(() => json({ success: true, executedStatements: 0 }));
  await run(["deploy", "run", "p1", "c1"], bare.io);
  assert.deepEqual(bare.calls[0].body, { resolutions: {} }, "no answer is invented, no backup choice is made");
});

test("a server refusal prints its code and message, exits 1, and in --json mode keeps the server's shape", async () => {
  const refusal = {
    error: "type the connection's name",
    code: "PRODUCTION_CONFIRMATION_REQUIRED",
    environment: "Live",
  };
  const h = harness(() => json(refusal, 409));
  assert.equal(await run(["deploy", "run", "p1", "c1"], h.io), 1);
  assert.match(h.err(), /type the connection's name \(PRODUCTION_CONFIRMATION_REQUIRED\)\n {2}environment: Live/);
  assert.equal(h.out(), "");

  const machine = harness(() => json(refusal, 409));
  assert.equal(await run(["deploy", "run", "p1", "c1", "--json"], machine.io), 1);
  assert.deepEqual(JSON.parse(machine.out()), { ...refusal, status: 409 });
});

test("authentication problems and an unreachable server exit 3, a bad command line exits 2", async () => {
  assert.equal(
    await run(["projects", "list"], harness(() => json({ error: "sign in", code: "AUTH_REQUIRED" }, 401)).io),
    3,
  );
  assert.equal(
    await run(["projects", "list"], harness(() => json({ error: "scope", code: "API_SCOPE_INSUFFICIENT" }, 403)).io),
    3,
  );
  assert.equal(await run(["lint", "p1"], harness(() => json({ error: "no", code: "FORBIDDEN" }, 403)).io), 1);

  const down = harness(() => {
    throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }) });
  });
  assert.equal(await run(["projects", "list"], down.io), 3);
  assert.match(down.err(), /cannot reach http:\/\/localhost:3001: ECONNREFUSED/);

  const usage = harness(() => json({}));
  assert.equal(await run(["lint"], usage.io), 2);
  assert.match(usage.err(), /missing <projectId>/);
  assert.equal(usage.calls.length, 0);
  assert.equal(await run(["lint", "p1"], { ...usage.io, env: { NEBULADB_URL: URL } }), 2);
  assert.equal(await run(["lint", "p1", "--url", "http://example.com"], usage.io), 2);
  assert.equal(usage.calls.length, 0, "nothing is sent over a refused address");
});

test("the key never reaches the output, even when a server echoes it", async () => {
  const h = harness(() => json({ error: `bad token ${KEY}`, code: "AUTH_REQUIRED" }, 401));
  await run(["projects", "list"], h.io);
  await run(["projects", "list", "--json"], h.io);
  assert.ok(!h.err().includes(KEY) && !h.out().includes(KEY));
  assert.match(h.err(), /\[redacted\]/);
});

test("project export writes a file or prints the content; history export needs its zip path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nebuladb-cli-"));
  const file = join(dir, "schema.dbml");
  const h = harness(() => new Response("Table a {}\n"));
  assert.equal(await run(["project", "export", "p1", "-o", file], h.io), 0);
  assert.equal(readFileSync(file, "utf8"), "Table a {}\n");
  assert.equal(h.calls[0].url, `${URL}/api/v1/projects/p1/export/dbml`);

  const stdout = harness(() => new Response("{}"));
  assert.equal(await run(["project", "export", "p1", "--format", "bundle"], stdout.io), 0);
  assert.equal(stdout.out(), "{}", "the file's content, byte for byte");
  assert.equal(stdout.calls[0].url, `${URL}/api/v1/projects/p1/export/bundle`);

  const zip = join(dir, "migrations.zip");
  const history = harness(() => new Response(new Uint8Array([80, 75, 3, 4])));
  assert.equal(await run(["history", "export", "p1", "c1", "--format", "flyway", "-o", zip], history.io), 0);
  assert.deepEqual([...readFileSync(zip)], [80, 75, 3, 4]);
  assert.equal(history.calls[0].url, `${URL}/api/v1/projects/p1/connections/c1/history/export?format=flyway`);
});

test("project import picks bundle or DBML from the file, and reads nothing it cannot find", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nebuladb-cli-"));
  const dbml = join(dir, "a.dbml");
  const bundle = join(dir, "a.json");
  writeFileSync(dbml, "Table a { id int }");
  writeFileSync(bundle, '{"format":"nebuladb-bundle"}');

  const h = harness(() =>
    json({ imported: true, tables: 1, locks: 0, seeds: 0, generators: 0, skipped: ["lock on b"] }),
  );
  assert.equal(await run(["project", "import", "p1", dbml], h.io), 0);
  assert.equal(h.calls[0].url, `${URL}/api/v1/projects/p1/import`);
  assert.deepEqual(h.calls[0].body, { source: "Table a { id int }" });

  assert.equal(await run(["project", "import", "p1", bundle], h.io), 0);
  assert.equal(h.calls[1].url, `${URL}/api/v1/projects/p1/import/bundle`);
  assert.match(h.out(), /Left alone: lock on b/);

  assert.equal(await run(["project", "import", "p1", join(dir, "missing")], h.io), 2);
  assert.equal(h.calls.length, 2);
});

test("--version and --help need no instance and no key", async () => {
  const h = harness(() => json({}));
  const bare: Io = { ...h.io, env: {} };
  assert.equal(await run(["--version"], bare), 0);
  assert.match(h.out(), /^\d+\.\d+\.\d+\n/);
  assert.equal(await run(["deploy", "run", "--help"], bare), 0);
  assert.match(h.out(), /--confirm-name <name>/);
});
