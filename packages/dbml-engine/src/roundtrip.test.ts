import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSql, toProject, projectToSql, mergeProjectIntoExisting } from "./dbml.js";
import { diffProjects } from "./diff.js";

const SAMPLE_SQL = `
CREATE TABLE users (
  id INT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE
);
CREATE TABLE posts (
  id INT PRIMARY KEY,
  user_id INT,
  title VARCHAR(255) NOT NULL
);
ALTER TABLE posts ADD FOREIGN KEY (user_id) REFERENCES users(id);
`;

/**
 * Mirrors how the app actually round-trips a reimport (see the server's
 * `/import` route): the freshly re-parsed project is never diffed directly
 * against the prior one — `diffProjects` matches by entity *id*, and a fresh
 * parse gets fresh, unrelated ids every time. It's always reconciled through
 * `mergeProjectIntoExisting` first, which matches by *name* to recover the
 * stable ids, and diffing happens against *that*. A test that diffed two raw
 * `toProject` outputs directly would "fail" on every table looking removed +
 * re-added even when nothing changed — not what round-trip fidelity means
 * for this app.
 */
test("round-trip fidelity: import SQL -> edit -> export SQL -> re-import -> merge shows only the deliberate edit", () => {
  const original = toProject(parseSql(SAMPLE_SQL, "postgres"), "Test");
  assert.equal(original.tables.length, 2);
  assert.equal(original.refs.length, 1);

  // Simulate a user edit made directly on the live project (e.g. via the
  // canvas or DBML panel) after the initial SQL import: add a column.
  const edited = {
    ...original,
    tables: original.tables.map((t) =>
      t.name === "posts"
        ? { ...t, fields: [...t.fields, { id: "new-field-id", name: "published_at", type: "timestamp" }] }
        : t,
    ),
  };

  const exportedSql = projectToSql(edited, "postgres");
  assert.match(exportedSql, /published_at/);

  // Re-import that export as if pasted back in (or auto-synced) — this is
  // the actual round trip: parse fresh, then reconcile against the current
  // live state by name.
  const reparsed = toProject(parseSql(exportedSql, "postgres"), "Test");
  const merged = mergeProjectIntoExisting(edited, reparsed);

  const diff = diffProjects(edited, merged);
  assert.deepEqual(diff.tables, [], "SQL round trip introduces no spurious table/field changes once reconciled");
  assert.deepEqual(diff.refs, [], "the FK survives the round trip unchanged");

  // Ids specifically: the whole point of merging by name is that they don't
  // get reshuffled just because the text passed through a parser again.
  const postsBefore = edited.tables.find((t) => t.name === "posts")!;
  const postsAfter = merged.tables.find((t) => t.name === "posts")!;
  assert.equal(postsAfter.id, postsBefore.id);
  assert.equal(
    postsAfter.fields.find((f) => f.name === "title")!.id,
    postsBefore.fields.find((f) => f.name === "title")!.id,
  );

  // Structure — PK/FK/unique/not-null — survives intact.
  const usersAfter = merged.tables.find((t) => t.name === "users")!;
  assert.equal(usersAfter.fields.find((f) => f.name === "id")?.pk, true);
  assert.equal(usersAfter.fields.find((f) => f.name === "email")?.unique, true);
  assert.equal(usersAfter.fields.find((f) => f.name === "email")?.notNull, true);
  assert.equal(merged.refs.length, 1);
  assert.equal(merged.refs[0].from.tableId, postsAfter.id);
});

test("round-trip fidelity holds across all three SQL dialects", () => {
  for (const dialect of ["postgres", "mysql", "mssql"] as const) {
    const original = toProject(parseSql(SAMPLE_SQL, "postgres"), "Test");
    const exported = projectToSql(original, dialect);
    const reparsed = toProject(parseSql(exported, dialect), "Test");
    const merged = mergeProjectIntoExisting(original, reparsed);
    const diff = diffProjects(original, merged);
    assert.deepEqual(diff.tables, [], `no drift for dialect ${dialect}`);
    assert.equal(merged.refs.length, 1, `FK survives for dialect ${dialect}`);
  }
});
