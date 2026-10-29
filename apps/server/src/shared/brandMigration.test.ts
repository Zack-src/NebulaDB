import test from "node:test";
import assert from "node:assert/strict";
import { readEnv } from "./brandMigration.js";

test("legacy configuration is accepted; new values, including empty ones, take precedence", () => {
  process.env.ATHANORDB_MIGRATION_TEST = "legacy";
  try {
    assert.equal(readEnv("NEBULADB_MIGRATION_TEST"), "legacy");
    process.env.NEBULADB_MIGRATION_TEST = "new";
    assert.equal(readEnv("NEBULADB_MIGRATION_TEST"), "new");
    process.env.NEBULADB_MIGRATION_TEST = "";
    assert.equal(readEnv("NEBULADB_MIGRATION_TEST"), "");
  } finally {
    delete process.env.ATHANORDB_MIGRATION_TEST;
    delete process.env.NEBULADB_MIGRATION_TEST;
  }
});
