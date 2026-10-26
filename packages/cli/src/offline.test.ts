import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { run, type Io } from "./cli.js";
import { parseCommandLine } from "./args.js";
import { locate } from "./offline.js";

const dir = mkdtempSync(join(tmpdir(), "nebuladb-offline-"));
const file = (name: string, content: string) => {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
};

const OLD = file(
  "old.dbml",
  `Table users {
  id int [pk]
  email varchar
}
Table sales.orders {
  id int
  user_id int
}
Ref: sales.orders.user_id > users.id
`,
);
const NEW = file(
  "new.dbml",
  `Table users {
  id int [pk]
  email varchar [unique, not null]
  name text
}
Table posts {
  id int [pk]
}
`,
);
const BROKEN = file("broken.dbml", "Table users {\n  id int [pk\n}\n");
const CLEAN = file("clean.dbml", "Table users {\n  id int [pk]\n  name text\n}\n");

/** No NEBULADB_URL and no key: the offline commands must not ask for them, and no fetch is available. */
function harness() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: Io = { stdout: (t) => void stdout.push(t), stderr: (t) => void stderr.push(t), env: {} };
  return { io, out: () => stdout.join(""), err: () => stderr.join("") };
}

test("lint <file>: findings carry file:line:column, and warnings alone do not fail", async () => {
  const h = harness();
  assert.equal(await run(["lint", OLD], h.io), 0);
  assert.match(h.out(), /old\.dbml:5:1 {2}warning orders: .*\[pk-required\]/);
  assert.match(h.out(), /old\.dbml:7:3 {2}warning orders\.user_id: .*\[fk-indexed\]/);
  assert.match(h.out(), /0 errors, 2 warnings/);
  assert.equal(h.err(), "");
});

test("lint <file> --fail-on warning exits 1 on warnings; a clean file exits 0", async () => {
  assert.equal(await run(["lint", OLD, "--fail-on", "warning"], harness().io), 1);
  assert.equal(await run(["lint", CLEAN, "--fail-on", "warning"], harness().io), 0);
});

test("lint <file> --format json prints the report, --format markdown a table", async () => {
  const json = harness();
  assert.equal(await run(["lint", OLD, "--format", "json"], json.io), 0);
  const report = JSON.parse(json.out());
  assert.equal(report.summary.warning, 2);
  assert.equal(report.failed, false);
  assert.ok(report.findings.some((f: { ruleId: string; line: number }) => f.ruleId === "pk-required" && f.line === 5));

  const md = harness();
  await run(["lint", OLD, "--format", "markdown"], md.io);
  assert.match(md.out(), /^### NebulaDB lint: passed/);
  assert.match(md.out(), /\| warning \| `orders` \(line 5\) \|/);
});

test("lint <file>: a DBML syntax error exits 1 with its position; a missing file is a usage error", async () => {
  const bad = harness();
  assert.equal(await run(["lint", BROKEN], bad.io), 1);
  assert.match(bad.err(), /broken\.dbml:3:1: /);

  const missing = harness();
  assert.equal(await run(["lint", join(dir, "nope.dbml")], missing.io), 2);
  assert.match(missing.err(), /cannot read .*nope\.dbml/);
});

test("diff: text, markdown and json; --exit-code turns a difference into exit 1", async () => {
  const text = harness();
  assert.equal(await run(["diff", OLD, NEW], text.io), 0);
  assert.match(text.out(), /~ changed table users/);
  assert.match(text.out(), /\+ added name: text/);
  assert.match(text.out(), /- removed table orders/);
  assert.match(text.out(), /\+ added table posts/);
  assert.match(text.out(), /- removed ref sales\.orders\.user_id/);

  const md = harness();
  assert.equal(await run(["diff", OLD, NEW, "--format", "markdown", "--exit-code"], md.io), 1);
  assert.match(md.out(), /^### NebulaDB schema diff/);
  assert.match(md.out(), /- added table `posts`/);
  assert.match(md.out(), /\n {2}- added name: text/);

  const json = harness();
  await run(["diff", OLD, NEW, "--format", "json"], json.io);
  const data = JSON.parse(json.out());
  assert.equal(data.counts.tables, 3);
  assert.equal(data.counts.refs, 1);
});

test("diff of identical files reports no change and exits 0 even with --exit-code", async () => {
  const h = harness();
  assert.equal(await run(["diff", OLD, OLD, "--exit-code"], h.io), 0);
  assert.match(h.out(), /No schema change/);
});

test("diff matches tables by name, so a table added at the top does not make the rest look changed", async () => {
  const added = file("added.dbml", "Table first {\n  id int [pk]\n}\nTable users {\n  id int [pk]\n  email varchar\n}\n");
  const h = harness();
  await run(["diff", OLD, added, "--format", "json"], h.io);
  const data = JSON.parse(h.out());
  assert.ok(!data.tables.some((t: { name: string; status: string }) => t.name === "users" && t.status === "changed"));
});

test("lint selects the offline form on a path only; a project id still goes to the server", () => {
  const file = parseCommandLine(["lint", "some/schema.dbml"]);
  assert.ok(file.kind === "run" && file.command.id === "lint.file" && file.command.offline === true);
  const dbml = parseCommandLine(["lint", "schema.dbml", "--fail-on", "warning"]);
  assert.ok(dbml.kind === "run" && dbml.command.id === "lint.file");
  const project = parseCommandLine(["lint", "p1"]);
  assert.ok(project.kind === "run" && project.command.id === "lint" && !project.command.offline);
  assert.throws(() => parseCommandLine(["diff", "only-one.dbml"]), /missing <new\.dbml>/);
});

test("locate: finds a table, a quoted table in a schema, and a field inside its own block", () => {
  const source = `Table a {\n  id int\n}\nTable "my"."t x" {\n  "col y" int\n  id int\n}\nTable b {\n  id int\n}\n`;
  assert.deepEqual(locate(source, undefined, "a"), { line: 1, column: 1 });
  assert.deepEqual(locate(source, "my", "t x", "col y"), { line: 5, column: 3 });
  assert.deepEqual(locate(source, undefined, "b", "id"), { line: 9, column: 3 });
  assert.equal(locate(source, undefined, "missing"), undefined);
});

test("the built binary runs offline with an empty environment", () => {
  const bin = fileURLToPath(new URL("./bin.js", import.meta.url));
  const lint = spawnSync(process.execPath, [bin, "lint", OLD, "--fail-on", "warning"], { env: { PATH: process.env.PATH }, encoding: "utf8" });
  assert.equal(lint.status, 1);
  assert.match(lint.stdout, /old\.dbml:5:1/);
  const diff = spawnSync(process.execPath, [bin, "diff", OLD, NEW, "--format", "markdown"], { env: { PATH: process.env.PATH }, encoding: "utf8" });
  assert.equal(diff.status, 0);
  assert.match(diff.stdout, /### NebulaDB schema diff/);
});
