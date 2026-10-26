import { test } from "node:test";
import assert from "node:assert/strict";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

// Nothing here touches the database, but `shared/errors.ts` pulls in the
// config, which insists on one.
await useTestDatabase("dbmlsource");

const { ApiError } = await import("../../shared/errors.js");
const { clearParseCache, parseBaselineProject, parseSourceProject } = await import("./dbmlSource.js");
const { closeParsePool } = await import("./parsePool.js");

// Large enough to go through a worker thread (see `inlineBelowChars`).
const BIG_DBML = Array.from(
  { length: 120 },
  (_, i) => `Table t${i} {\n  id int [pk]\n  label varchar [note: 'padding padding padding']\n}`,
).join("\n");

test.after(async () => {
  await closeParsePool();
});

test("an unchanged baseline is parsed once: the next sync's baseline is a cache hit on this sync's source", async () => {
  clearParseCache();
  const source = await parseSourceProject(BIG_DBML, null, "P");
  assert.equal(source.tables.length, 120);
  const baseline = await parseBaselineProject(BIG_DBML, "P");
  assert.equal(baseline, source, "same object — no second parse");
  assert.ok(Object.isFrozen(baseline) && Object.isFrozen(baseline.tables[0]), "shared results are read-only");

  // Keyed on the project name too: it's part of the parsed `Project`.
  const other = await parseBaselineProject(BIG_DBML, "Q");
  assert.notEqual(other, source);
  assert.equal(other.name, "Q");
});

test("concurrent parses of the same text share one parse", async () => {
  clearParseCache();
  const text = `${BIG_DBML}\nTable extra {\n  id int\n}`;
  const [a, b] = await Promise.all([parseSourceProject(text, null, "P"), parseBaselineProject(text, "P")]);
  assert.equal(a, b);
});

test("a source that doesn't parse is a 400 keeping the engine's line/column, as before", async () => {
  clearParseCache();
  await assert.rejects(parseSourceProject(`${BIG_DBML}\nTable broken {\n  id int [pk\n}`, null, "P"), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.code, "DBML_PARSE_FAILED");
    assert.match(err.message, /^DBML parse error: /);
    assert.equal(typeof (err.details as { line?: unknown }).line, "number");
    return true;
  });
  await assert.rejects(parseSourceProject("CREATE TABLE (((", "postgres", "P"), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.code, "SQL_PARSE_FAILED");
    return true;
  });
});

test("a baseline that doesn't parse is treated as no baseline", async () => {
  clearParseCache();
  const baseline = await parseBaselineProject("Table {{{ not dbml", "P");
  assert.deepEqual(baseline, {
    id: "",
    name: "P",
    tables: [],
    refs: [],
    enums: [],
    zones: [],
    stickyNotes: [],
    tableGroups: [],
  });
});
