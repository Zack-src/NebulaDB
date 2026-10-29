import test from "node:test";
import assert from "node:assert/strict";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

// `deploy.ts` reaches the database layer through its imports: it needs one to connect to, even with nothing to store.
await useTestDatabase("deployfailure");

const { describeFailedStatement } = await import("./deploy.js");

test("a failure that names its statement says which one it was", () => {
  const sql = "CREATE TABLE `a` (\n  `x` STRING DEFAULT 0\n);\n\nALTER TABLE `b` ADD COLUMN `y` INT64;";
  const found = describeFailedStatement(sql, "statement 1 of 2 failed: Column default expression has type INT64 at [2:3]");
  assert.deepEqual(found, {
    failedIndex: 1,
    failedTotal: 2,
    failedStatement: "CREATE TABLE `a` (\n  `x` STRING DEFAULT 0\n)",
  });
});

test("BEGIN and COMMIT are not counted as statements, like the drivers", () => {
  const found = describeFailedStatement("BEGIN;\nDROP TABLE `a`;\nCOMMIT;", "statement 1 of 1 failed: boom");
  assert.equal((found as { failedStatement: string }).failedStatement, "DROP TABLE `a`");
});

test("an error without a position, or a position past the script, gives nothing", () => {
  assert.deepEqual(describeFailedStatement("DROP TABLE a;", "relation \"a\" does not exist"), {});
  assert.deepEqual(describeFailedStatement("DROP TABLE a;", "statement 4 of 4 failed: x"), {});
  assert.deepEqual(describeFailedStatement("DROP TABLE a;", undefined), {});
});
