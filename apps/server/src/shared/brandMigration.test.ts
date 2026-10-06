import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEnv, defaultDbPath } from "./brandMigration.js";

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

test("an existing historical database remains the default until a new one exists", () => {
  const cwd = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "nebuladb-path-migration-"));
  try {
    process.chdir(dir);
    assert.equal(defaultDbPath(), "./data/nebuladb.sqlite");
    mkdirSync("data");
    writeFileSync("data/athanordb.sqlite", "fixture");
    assert.equal(defaultDbPath(), "./data/athanordb.sqlite");
    writeFileSync("data/nebuladb.sqlite", "fixture");
    assert.equal(defaultDbPath(), "./data/nebuladb.sqlite");
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
});
