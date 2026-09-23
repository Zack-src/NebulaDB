import { test } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseConnectionConfig } from "@athanordb/shared";
import { ApiError } from "../../shared/errors.js";
import { resetConnectionBudgets, takeConnectionBudget, targetKey } from "./connectionBudget.js";

function config(extra: Partial<DatabaseConnectionConfig>): DatabaseConnectionConfig {
  return { id: "c", projectId: "p", name: "n", engine: "postgres", ...extra };
}

test("the key identifies the target database, not the connection — and never holds the password", () => {
  const a = targetKey(config({ id: "one", host: "DB.example.com", port: 5432, database: "app", password: "s3cret" }));
  const b = targetKey(config({ id: "two", host: "db.example.com", port: 5432, database: "app", password: "other" }));
  const viaUrl = targetKey(config({ connectionString: "postgres://u:s3cret@db.example.com:5432/app" }));
  assert.equal(a, b, "two saved connections to one server share a budget");
  assert.equal(a, viaUrl, "host/port/database and a connection string to the same place agree");
  assert.notEqual(a, targetKey(config({ host: "db.example.com", port: 5432, database: "other" })));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(viaUrl, /s3cret/);
});

test("connect budget: 30 a minute, then 429 with a retry hint, then free again once the window slides", () => {
  resetConnectionBudgets();
  const t0 = 1_000_000;
  for (let i = 0; i < 30; i++) takeConnectionBudget("k", "connect", t0 + i);
  assert.throws(
    () => takeConnectionBudget("k", "connect", t0 + 100),
    (err: unknown) => err instanceof ApiError && err.code === "CONNECTION_RATE_LIMITED",
  );
  takeConnectionBudget("other-target", "connect", t0 + 100); // a different database is unaffected
  takeConnectionBudget("k", "connect", t0 + 60_001); // oldest hit has left the window
});

test("write budget is separate and much smaller", () => {
  resetConnectionBudgets();
  for (let i = 0; i < 5; i++) takeConnectionBudget("k", "write", i);
  assert.throws(() => takeConnectionBudget("k", "write", 10));
  takeConnectionBudget("k", "connect", 10);
});
