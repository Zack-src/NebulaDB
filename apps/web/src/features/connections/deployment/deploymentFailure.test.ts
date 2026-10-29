import assert from "node:assert/strict";
import test from "node:test";
import { parseDeploymentFailure } from "./deploymentFailure.js";

test("the position the engine gives points at the column of a CREATE TABLE", () => {
  const failure = parseDeploymentFailure({
    error:
      "statement 1 of 43 failed: Column default expression has type INT64 which cannot be assigned to column type STRING at [3:35]",
    failedIndex: 1,
    failedTotal: 43,
    failedStatement: "CREATE TABLE `prioritization` (\n  `id` INT64 NOT NULL,\n  `label` STRING DEFAULT 0\n)",
  })!;
  assert.equal(failure.table, "prioritization");
  assert.equal(failure.column, "label");
  assert.equal(failure.index, 1);
  assert.equal(failure.total, 43);
  assert.match(failure.reason, /^Column default expression/);
});

test("an ALTER names its table and its column", () => {
  const failure = parseDeploymentFailure({
    error: "statement 7 of 9 failed: boom",
    failedIndex: 7,
    failedTotal: 9,
    failedStatement: 'ALTER TABLE "orders" ADD COLUMN "total" numeric',
  })!;
  assert.equal(failure.table, "orders");
  assert.equal(failure.column, "total");
});

test("an index names the table it is on, and no column", () => {
  const failure = parseDeploymentFailure({
    error: "statement 2 of 3 failed: boom",
    failedIndex: 2,
    failedTotal: 3,
    failedStatement: "CREATE UNIQUE INDEX `ix` ON `users` (`email`)",
  })!;
  assert.equal(failure.table, "users");
  assert.equal(failure.column, undefined);
});

test("a failure with no statement is not one", () => {
  assert.equal(parseDeploymentFailure({ error: "relation does not exist" }), null);
});
