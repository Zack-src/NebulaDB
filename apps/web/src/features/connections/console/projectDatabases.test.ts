import { test } from "node:test";
import assert from "node:assert/strict";
import { findDatabaseIssues } from "./projectDatabases";

const row = (projectId: string, value: string, trashed = false) => ({ projectId, trashed, value });

test("distinct databases raise no issue", () => {
  assert.equal(findDatabaseIssues([row("a", "shop"), row("b", "blog")], "main").size, 0);
});

test("a name outside the allowed pattern is flagged", () => {
  const issues = findDatabaseIssues([row("a", "my db"), row("b", "ok_1")], "main");
  assert.equal(issues.get("a"), "invalid");
  assert.equal(issues.has("b"), false);
});

test("two projects on the same database are flagged, without regard to case", () => {
  const issues = findDatabaseIssues([row("a", "Shop"), row("b", " shop "), row("c", "blog")], "main");
  assert.deepEqual(
    [...issues],
    [
      ["a", "duplicate"],
      ["b", "duplicate"],
    ],
  );
});

test("an empty value is the connection's own database", () => {
  assert.equal(findDatabaseIssues([row("a", ""), row("b", "MAIN")], "main").get("b"), "duplicate");
  assert.equal(findDatabaseIssues([row("a", ""), row("b", "")], "main").size, 2);
});

test("a trashed project does not hold a database", () => {
  assert.equal(findDatabaseIssues([row("a", "shop"), row("b", "shop", true)], "main").size, 0);
});
