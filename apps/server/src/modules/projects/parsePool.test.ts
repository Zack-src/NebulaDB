import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { createParsePool } from "./parsePool.js";
import { runParseTask, type ParseResult } from "./parseTask.js";

// No database: the pool and the parse cache are pure CPU. The route-level
// behaviour (same responses as before) is covered in `routes.test.ts`.

function largeDbml(tables: number): string {
  const lines: string[] = [];
  for (let i = 0; i < tables; i++) {
    lines.push(`Table t${i} {\n  id int [pk]\n  name varchar [not null]\n  parent_id int\n  created_at timestamp\n}`);
    if (i > 0) lines.push(`Ref: t${i}.parent_id > t${i - 1}.id`);
  }
  return lines.join("\n");
}

/** `toProject` gives every parse a fresh random project id; everything else must match exactly. */
function comparable(result: ParseResult) {
  return result.ok ? { ...result, project: { ...result.project, id: "" } } : result;
}

/** A thread that says it's ready and then does whatever `onMessage` says — for the failure paths. */
function fakeWorker(onMessage: string): () => Worker {
  return () =>
    new Worker(
      `const { parentPort } = require("node:worker_threads");
       parentPort.on("message", (m) => { ${onMessage} });
       parentPort.postMessage({ ready: true });`,
      { eval: true },
    );
}

test("a source parsed in a worker thread comes back identical to an inline parse", async () => {
  const pool = createParsePool({ size: 2, inlineBelowChars: 0 });
  try {
    const task = { source: largeDbml(80), dialect: null, projectName: "P" };
    const result = await pool.run(task);
    assert.equal(pool.stats().inlineOnly, false);
    assert.ok(pool.stats().threads >= 1, "the task went through a thread");
    assert.deepEqual(comparable(result), comparable(runParseTask(task)));
    assert.equal(result.ok && result.project.tables.length, 80);

    const sql = {
      source: "CREATE TABLE users (id int PRIMARY KEY, email varchar(255));",
      dialect: "postgres" as const,
      projectName: "P",
    };
    assert.deepEqual(comparable(await pool.run(sql)), comparable(runParseTask(sql)));
  } finally {
    await pool.close();
  }
});

test("a parse error crosses the thread boundary with its line/column", async () => {
  const pool = createParsePool({ inlineBelowChars: 0 });
  try {
    const result = await pool.run({ source: "Table users {\n  id int [pk\n}", dialect: null, projectName: "P" });
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.kind === "parse");
    assert.equal(typeof result.error.line, "number");
    assert.ok(result.error.message.length > 0);
  } finally {
    await pool.close();
  }
});

test("tasks queue behind a busy pool and all complete, in any number", async () => {
  const pool = createParsePool({ size: 2, inlineBelowChars: 0 });
  try {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => pool.run({ source: largeDbml(5 + i), dialect: null, projectName: "P" })),
    );
    results.forEach((result, i) => assert.equal(result.ok && result.project.tables.length, 5 + i));
    assert.ok(pool.stats().threads <= 2);
    assert.equal(pool.stats().queued, 0);
  } finally {
    await pool.close();
  }
});

test("a task that outlives the timeout is stopped, reported as a parse failure, and its thread replaced", async () => {
  let spawned = 0;
  const hang = fakeWorker("/* never answers */");
  const pool = createParsePool({
    size: 1,
    timeoutMs: 200,
    inlineBelowChars: 0,
    spawn: () => {
      spawned++;
      return hang();
    },
  });
  try {
    const result = await pool.run({ source: "Table a {\n id int\n}", dialect: null, projectName: "P" });
    assert.ok(!result.ok && result.kind === "parse");
    assert.match(result.error.message, /took longer than/);
    assert.equal(pool.stats().threads, 0, "the stuck thread was terminated");

    await pool.run({ source: "Table a {\n id int\n}", dialect: null, projectName: "P" });
    assert.equal(spawned, 2, "the next task got a fresh thread");
  } finally {
    await pool.close();
  }
});

test("a thread that dies mid-task fails that task with an internal error, not a parse error", async () => {
  const pool = createParsePool({ size: 1, inlineBelowChars: 0, spawn: fakeWorker("process.exit(3);") });
  try {
    const result = await pool.run({ source: "Table a {\n id int\n}", dialect: null, projectName: "P" });
    assert.ok(!result.ok && result.kind === "internal");
    assert.match(result.message, /code 3/);
    assert.equal(pool.stats().inlineOnly, false);
  } finally {
    await pool.close();
  }
});

test("a thread that can't start falls back to parsing inline, for good", async () => {
  const pool = createParsePool({
    inlineBelowChars: 0,
    spawn: () => new Worker(new URL("./no-such-worker.js", import.meta.url)),
  });
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const task = { source: largeDbml(3), dialect: null, projectName: "P" };
    assert.deepEqual(comparable(await pool.run(task)), comparable(runParseTask(task)));
    assert.equal(pool.stats().inlineOnly, true);
    assert.deepEqual(comparable(await pool.run(task)), comparable(runParseTask(task)));
  } finally {
    console.warn = originalWarn;
    await pool.close();
  }
});

test("an idle pool, never closed, doesn't keep the process alive", async () => {
  const script = `
    const { createParsePool } = await import(${JSON.stringify(new URL("./parsePool.js", import.meta.url).href)});
    const pool = createParsePool({ inlineBelowChars: 0 });
    const result = await pool.run({ source: "Table a {\\n id int\\n}", dialect: null, projectName: "P" });
    if (!result.ok || pool.stats().threads !== 1) process.exit(3);`;
  // A file rather than `-e`: threads inherit `execArgv`, and `--input-type` is rejected there.
  const file = join(tmpdir(), `nebuladb-parsepool-${randomUUID()}.mjs`);
  writeFileSync(file, script);
  after(() => rmSync(file, { force: true }));
  const child = spawn(process.execPath, [file], { stdio: "ignore" });
  const code = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 15_000);
    child.on("exit", (exitCode) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
  });
  assert.equal(code, 0, code === null ? "the process was still alive after 15 s" : `exit code ${code}`);
});

test("small sources skip the thread round trip", async () => {
  let spawned = 0;
  const pool = createParsePool({
    inlineBelowChars: 1_000,
    spawn: () => {
      spawned++;
      throw new Error("should not spawn");
    },
  });
  const result = await pool.run({ source: "Table a {\n id int\n}", dialect: null, projectName: "P" });
  assert.equal(result.ok, true);
  assert.equal(spawned, 0);
  await pool.close();
});
