import { test } from "node:test";
import assert from "node:assert/strict";
import type { Project } from "@athanordb/shared";
import { parseDbml, projectToSql, toProject } from "./dbml.js";
import { diffTargetAgainstLive } from "./migrationDiff.js";
import { generateMigrationSql } from "./migrationGenerator.js";
import { applyVisualMetadata, projectToDbml } from "./serialize.js";

/**
 * Every way DBML can spell one relation must land in the model the same way
 * round: `from` = the column carrying the foreign key, `to` = the column it
 * references (see `refOrientation.ts` in `@athanordb/shared`). Inline refs
 * used to come out backwards, which put the FK on the wrong table in every
 * SQL export and deployment.
 */

const USERS = "Table users {\n  id integer [pk]\n}\n";
const POSTS_PLAIN = "Table posts {\n  id integer [pk]\n  author_id integer\n}\n";

const ONE_TO_MANY_FORMS: Record<string, string> = {
  "inline on the FK column: author_id [ref: > users.id]": `${USERS}Table posts {\n  id integer [pk]\n  author_id integer [ref: > users.id]\n}\n`,
  "inline on the referenced column: users.id [ref: < posts.author_id]": `Table users {\n  id integer [pk, ref: < posts.author_id]\n}\n${POSTS_PLAIN}`,
  "explicit: Ref: posts.author_id > users.id": `${USERS}${POSTS_PLAIN}Ref: posts.author_id > users.id\n`,
  "explicit: Ref: users.id < posts.author_id": `${USERS}${POSTS_PLAIN}Ref: users.id < posts.author_id\n`,
  "long form: Ref { posts.author_id > users.id }": `${USERS}${POSTS_PLAIN}Ref {\n  posts.author_id > users.id\n}\n`,
};

function parse(source: string): Project {
  return toProject(parseDbml(source), "p", source);
}

function endpoints(project: Project): string[] {
  const byId = new Map(project.tables.map((t) => [t.id, t]));
  return project.refs.map((ref) => {
    const from = byId.get(ref.from.tableId)!;
    const to = byId.get(ref.to.tableId)!;
    const fromField = from.fields.find((f) => f.id === ref.from.fieldId)!;
    const toField = to.fields.find((f) => f.id === ref.to.fieldId)!;
    return `${from.name}.${fromField.name} -> ${to.name}.${toField.name} (${ref.cardinality})`;
  });
}

for (const [form, source] of Object.entries(ONE_TO_MANY_FORMS)) {
  test(`one-to-many, ${form}: FK on posts.author_id, everywhere`, () => {
    const project = parse(source);
    assert.deepEqual(endpoints(project), ["posts.author_id -> users.id (one-to-many)"]);

    assert.match(
      projectToSql(project, "postgres"),
      /ALTER TABLE "posts" ADD FOREIGN KEY \("author_id"\) REFERENCES "users" \("id"\)/,
    );

    const empty: Project = { ...project, tables: [], refs: [] };
    const migration = generateMigrationSql(diffTargetAgainstLive(empty, project), "postgres");
    assert.match(
      migration,
      /ALTER TABLE "posts" ADD CONSTRAINT "[^"]+" FOREIGN KEY \("author_id"\) REFERENCES "users" \("id"\)/,
    );

    // Stable across DBML round trips — the DBML panel re-serializes on every edit.
    const once = parse(projectToDbml(project));
    const twice = parse(projectToDbml(once));
    assert.deepEqual(endpoints(once), endpoints(project));
    assert.deepEqual(endpoints(twice), endpoints(project));
  });
}

test("the reversed-symbol spelling on its own column is still rejected (a ref to itself)", () => {
  assert.throws(() => parseDbml("Table users {\n  id integer [pk, ref: < users.id]\n}\n"));
});

test("one-to-one: inline on the FK column puts the FK there, and survives round trips", () => {
  const source =
    "Table organizations {\n  id integer [pk]\n}\nTable subscriptions {\n  id integer [pk]\n  organization_id integer [unique, ref: - organizations.id]\n}\n";
  const project = parse(source);
  assert.deepEqual(endpoints(project), ["subscriptions.organization_id -> organizations.id (one-to-one)"]);
  assert.match(projectToSql(project, "postgres"), /ALTER TABLE "subscriptions" ADD FOREIGN KEY \("organization_id"\)/);
  const once = parse(projectToDbml(project));
  const twice = parse(projectToDbml(once));
  assert.deepEqual(endpoints(once), endpoints(project));
  assert.deepEqual(endpoints(twice), endpoints(project));
});

test("one-to-one, explicit: follows @dbml/core's own rule (FK on the second endpoint)", () => {
  const source =
    "Table organizations {\n  id integer [pk]\n}\nTable subscriptions {\n  id integer [pk]\n  organization_id integer [unique]\n}\nRef: organizations.id - subscriptions.organization_id\n";
  assert.deepEqual(endpoints(parse(source)), ["subscriptions.organization_id -> organizations.id (one-to-one)"]);
});

test("many-to-many keeps its declaration order and round-trips", () => {
  const source = `${USERS}Table groups {\n  id integer [pk]\n}\nRef: users.id <> groups.id\n`;
  const project = parse(source);
  assert.deepEqual(endpoints(project), ["users.id -> groups.id (many-to-many)"]);
  assert.deepEqual(endpoints(parse(projectToDbml(project))), endpoints(project));
});

test("a visual sidecar written with the old direction-sensitive key still restores the ref's style", () => {
  const source = `${USERS}${POSTS_PLAIN}Ref: posts.author_id > users.id\n// athanordb:visual ${JSON.stringify({
    refs: { "users.id->posts.author_id": { style: { color: "#ff0000" } } },
  })}\n`;
  const project = applyVisualMetadata(parse(source), source);
  assert.equal(project.refs[0].style?.color, "#ff0000");
});
