import { test } from "node:test";
import assert from "node:assert/strict";
import { useTestDatabase } from "./testDatabase.js";

// restore.ts imports db.ts (for the ownership lookup / project insert), which
// connects at import time — same reasoning as auth/session.test.ts and
// permissions.test.ts: give it a throwaway database before the (dynamic)
// import touches it, so this suite never opens a real one just to test two
// pure string-parsing helpers.
await useTestDatabase("test");

const { nameFromFilename, parseArgs } = await import("./restore.js");

test("nameFromFilename strips the extension and backup.ts's dedup suffix, and un-sanitizes underscores", () => {
  assert.equal(nameFromFilename("Blog_Platform.dbml"), "Blog Platform");
  assert.equal(nameFromFilename("Blog_Platform-1.dbml"), "Blog Platform");
  assert.equal(nameFromFilename("Blog_Platform-12.dbml"), "Blog Platform");
  assert.equal(nameFromFilename("simple.dbml"), "simple");
});

test("nameFromFilename falls back to a placeholder for a name that sanitizes to nothing", () => {
  assert.equal(nameFromFilename(".dbml"), "Restored project");
  assert.equal(nameFromFilename("___.dbml"), "Restored project");
});

test("nameFromFilename is case-insensitive about the .dbml extension", () => {
  assert.equal(nameFromFilename("Foo.DBML"), "Foo");
});

test("parseArgs separates the positional backup directory from --owner", () => {
  assert.deepEqual(parseArgs(["./backups/2026-08-09"]), { backupDir: "./backups/2026-08-09", ownerEmail: undefined });
  assert.deepEqual(parseArgs(["./backups/2026-08-09", "--owner", "admin@example.com"]), {
    backupDir: "./backups/2026-08-09",
    ownerEmail: "admin@example.com",
  });
  assert.deepEqual(parseArgs(["--owner", "admin@example.com", "./backups/2026-08-09"]), {
    backupDir: "./backups/2026-08-09",
    ownerEmail: "admin@example.com",
  });
});
