import { test } from "node:test";
import assert from "node:assert/strict";
import type { Project } from "@athanordb/shared";
import { parseDbml, toProject, projectToSql, mergeProjectIntoExisting } from "./dbml.js";
import { projectToDbml, extractVisualMetadata, applyVisualMetadata } from "./serialize.js";

test("DBML -> Project round-trips table/field constraints", () => {
  const source = `Table users {
  id int [pk, increment]
  email varchar [unique, not null]
  bio varchar [note: 'short bio']
  age int [default: 0]
  status varchar [default: 'draft']
}`;
  const project = toProject(parseDbml(source), "Test");
  const table = project.tables[0];
  assert.equal(table.name, "users");

  const id = table.fields.find((f) => f.name === "id")!;
  assert.equal(id.pk, true);
  assert.equal(id.increment, true);

  const email = table.fields.find((f) => f.name === "email")!;
  assert.equal(email.unique, true);
  assert.equal(email.notNull, true);

  const bio = table.fields.find((f) => f.name === "bio")!;
  assert.equal(bio.note, "short bio");

  // Regression: @dbml/core gives numeric defaults back as a JS `number`, not
  // a string, even though `Field.default` is typed `string`.
  const age = table.fields.find((f) => f.name === "age")!;
  assert.strictEqual(age.default, "0");
  assert.strictEqual(typeof age.default, "string");

  const status = table.fields.find((f) => f.name === "status")!;
  assert.strictEqual(status.default, "draft");

  const regenerated = projectToDbml(project);
  assert.match(regenerated, /\bpk\b/);
  assert.match(regenerated, /\bincrement\b/);
  assert.match(regenerated, /\bunique\b/);
  assert.match(regenerated, /not null/);
  assert.match(regenerated, /default: 0/);
  assert.match(regenerated, /default: 'draft'/);
});

test('implicit "public" schema (the parser\'s silent default) is not carried through when re-exported', () => {
  const source = `Table users {
  id int [pk]
}`;
  const project = toProject(parseDbml(source), "Test", source);
  assert.equal(project.tables[0].schemaName, undefined);
  assert.doesNotMatch(projectToDbml(project), /public/i);
});

test('explicit "public." schema in the source is preserved and re-exported', () => {
  const source = `Table public.users {
  id int [pk]
}`;
  const project = toProject(parseDbml(source), "Test", source);
  assert.equal(project.tables[0].schemaName, "public");
  assert.match(projectToDbml(project), /Table\s+public\.users/);
});

test("a non-default schema is always preserved, source or not", () => {
  const source = `Table billing.invoices {
  id int [pk]
}`;
  const withoutSource = toProject(parseDbml(source), "Test");
  assert.equal(withoutSource.tables[0].schemaName, "billing");

  const withSource = toProject(parseDbml(source), "Test", source);
  assert.equal(withSource.tables[0].schemaName, "billing");
  assert.match(projectToDbml(withSource), /Table\s+billing\.invoices/);
});

test("without source text, an implicit-default table has no schemaName (can't tell explicit from implicit, so assume implicit)", () => {
  const source = `Table users {
  id int [pk]
}`;
  const project = toProject(parseDbml(source));
  assert.equal(project.tables[0].schemaName, undefined);
});

test("ref endpoints resolve to real table/field ids, not names (regression: used to fall back to tableName/fieldNames)", () => {
  const source = `
Table users {
  id int [pk]
}

Table posts {
  id int [pk]
  user_id int
}

Ref: posts.user_id > users.id
`;
  const project = toProject(parseDbml(source), "Test");
  assert.equal(project.refs.length, 1);
  const ref = project.refs[0];

  const fromTable = project.tables.find((t) => t.id === ref.from.tableId);
  const toTable = project.tables.find((t) => t.id === ref.to.tableId);
  assert.ok(fromTable, `ref.from.tableId (${ref.from.tableId}) must match a real table id`);
  assert.ok(toTable, `ref.to.tableId (${ref.to.tableId}) must match a real table id`);
  assert.equal(fromTable!.name, "posts");
  assert.equal(toTable!.name, "users");

  const fromField = fromTable!.fields.find((f) => f.id === ref.from.fieldId);
  const toField = toTable!.fields.find((f) => f.id === ref.to.fieldId);
  assert.ok(fromField, `ref.from.fieldId (${ref.from.fieldId}) must match a real field id`);
  assert.ok(toField, `ref.to.fieldId (${ref.to.fieldId}) must match a real field id`);
  assert.equal(fromField!.name, "user_id");
  assert.equal(toField!.name, "id");

  // If the ids don't resolve, projectToDbml silently drops the Ref line
  // (fieldNameById returns null and the loop `continue`s) — this is the part
  // that actually surfaced the original bug.
  const dbml = projectToDbml(project);
  assert.match(dbml, /Ref:\s*posts\.user_id\s*>\s*users\.id/);
});

test("cardinality round-trips through DBML symbols", () => {
  const cases: Array<[string, Project["refs"][number]["cardinality"]]> = [
    ["-", "one-to-one"],
    [">", "one-to-many"],
    ["<>", "many-to-many"],
  ];
  for (const [symbol, expected] of cases) {
    const source = `
Table a { id int [pk] }
Table b { id int [pk] }
Ref: a.id ${symbol} b.id
`;
    const project = toProject(parseDbml(source), "Test");
    assert.equal(project.refs[0].cardinality, expected, `symbol ${symbol}`);
  }
});

test("projectToSql emits a foreign key constraint for postgres", () => {
  const source = `
Table users { id int [pk] }
Table posts {
  id int [pk]
  user_id int
}
Ref: posts.user_id > users.id
`;
  const project = toProject(parseDbml(source), "Test");
  const sql = projectToSql(project, "postgres");
  assert.match(sql, /FOREIGN KEY/i);
});

test("mergeProjectIntoExisting preserves position/detailLevel/style for tables matched by name", () => {
  const existing: Project = {
    id: "p1",
    name: "Test",
    tables: [
      {
        id: "old-id",
        name: "users",
        fields: [{ id: "old-field-id", name: "id", type: "int", pk: true }],
        indexes: [],
        position: { x: 777, y: 888 },
        detailLevel: "full",
        style: { color: "#123456" },
        comments: [{ id: "c1", author: "alice", text: "double-check this table", createdAt: "2026-01-01" }],
      },
    ],
    refs: [],
    enums: [],
    zones: [{ id: "z1", label: "Zone", position: { x: 0, y: 0 }, size: { width: 10, height: 10 } }],
    stickyNotes: [{ id: "s1", text: "note", position: { x: 0, y: 0 }, size: { width: 10, height: 10 } }],
    tableGroups: [],
  };

  const incoming = toProject(
    parseDbml(`
Table users {
  id int [pk]
  email varchar
}

Table posts {
  id int [pk]
}
`),
    "Test",
  );

  const merged = mergeProjectIntoExisting(existing, incoming);

  const users = merged.tables.find((t) => t.name === "users")!;
  assert.equal(users.id, "old-id", "existing table id preserved");
  assert.deepEqual(users.position, { x: 777, y: 888 }, "existing position preserved");
  assert.equal(users.detailLevel, "full", "existing detail level preserved");
  assert.deepEqual(users.style, { color: "#123456" }, "existing style preserved");
  assert.equal(
    users.comments?.length,
    1,
    "existing comments preserved (dropped otherwise, since DBML has no equivalent)",
  );
  assert.equal(users.comments?.[0].text, "double-check this table");

  const idField = users.fields.find((f) => f.name === "id")!;
  assert.equal(idField.id, "old-field-id", "existing field id preserved by name match");
  const emailField = users.fields.find((f) => f.name === "email")!;
  assert.notEqual(emailField.id, "old-field-id", "new field gets a fresh id, not the existing field's");

  const posts = merged.tables.find((t) => t.name === "posts")!;
  assert.notDeepEqual(posts.position, { x: 777, y: 888 }, "new table gets its own position, not the existing table's");
  assert.equal(posts.detailLevel, "standard", "new table gets incoming's default detail level");

  assert.deepEqual(merged.zones, existing.zones, "zones pass through untouched (no DBML equivalent)");
  assert.deepEqual(merged.stickyNotes, existing.stickyNotes, "sticky notes pass through untouched");
});

test("mergeProjectIntoExisting drops tables no longer present in incoming, and remaps ref endpoints onto merged ids", () => {
  const existing: Project = {
    id: "p1",
    name: "Test",
    tables: [
      {
        id: "old-users-id",
        name: "users",
        fields: [{ id: "old-id-field", name: "id", type: "int", pk: true }],
        indexes: [],
        position: { x: 5, y: 5 },
        detailLevel: "standard",
      },
      {
        id: "old-legacy-id",
        name: "legacy",
        fields: [],
        indexes: [],
        position: { x: 1, y: 1 },
        detailLevel: "standard",
      },
    ],
    refs: [],
    enums: [],
    zones: [],
    stickyNotes: [],
    tableGroups: [],
  };

  const incoming = toProject(
    parseDbml(`
Table users {
  id int [pk]
}
Table posts {
  id int [pk]
  user_id int
}
Ref: posts.user_id > users.id
`),
    "Test",
  );

  const merged = mergeProjectIntoExisting(existing, incoming);

  assert.equal(
    merged.tables.find((t) => t.name === "legacy"),
    undefined,
    "table removed from the DBML source is dropped from the merged result",
  );

  const usersTable = merged.tables.find((t) => t.name === "users")!;
  assert.equal(usersTable.id, "old-users-id");

  assert.equal(merged.refs.length, 1);
  const ref = merged.refs[0];
  const toTable = merged.tables.find((t) => t.id === ref.to.tableId);
  assert.equal(
    toTable?.name,
    "users",
    "ref remapped to point at the preserved existing table id, not incoming's freshly-parsed one",
  );
  assert.equal(ref.to.tableId, "old-users-id");
});

test("enums round-trip", () => {
  const source = `
Enum status {
  active
  inactive [note: 'archived']
}
`;
  const project = toProject(parseDbml(source), "Test");
  assert.equal(project.enums.length, 1);
  assert.equal(project.enums[0].name, "status");
  assert.equal(project.enums[0].values.length, 2);

  const dbml = projectToDbml(project);
  assert.match(dbml, /Enum status \{/);
  assert.match(dbml, /active/);
  assert.match(dbml, /inactive/);
});

test("table groups round-trip, and reimport preserves the group across a name-matched merge", () => {
  const source = `
Table users {
  id int [pk]
}

Table posts {
  id int [pk]
}

TableGroup content {
  users
  posts
}
`;
  const project = toProject(parseDbml(source), "Test");
  assert.equal(project.tableGroups.length, 1);
  assert.equal(project.tableGroups[0].name, "content");
  const users = project.tables.find((t) => t.name === "users")!;
  const posts = project.tables.find((t) => t.name === "posts")!;
  assert.deepEqual(new Set(project.tableGroups[0].tableIds), new Set([users.id, posts.id]));

  const dbml = projectToDbml(project);
  assert.match(dbml, /TableGroup content \{/);
  assert.match(dbml, /users/);
  assert.match(dbml, /posts/);

  // Re-parsing fresh text assigns @dbml/core's own positional ids, distinct
  // from `project`'s — merging back onto the original should keep the same
  // group id (matched by name) and remap membership onto the *original*
  // table ids, not the fresh parse's.
  const reparsed = toProject(parseDbml(dbml), "Test");
  const merged = mergeProjectIntoExisting(project, reparsed);
  assert.equal(merged.tableGroups.length, 1);
  assert.equal(merged.tableGroups[0].id, project.tableGroups[0].id, "group id is stable across a resync");
  assert.deepEqual(new Set(merged.tableGroups[0].tableIds), new Set([users.id, posts.id]));
});

test("a table group whose TableGroup block is removed from the source disappears from the merged project", () => {
  const existing: Project = {
    id: "p1",
    name: "Test",
    tables: [
      {
        id: "t1",
        name: "users",
        fields: [{ id: "f1", name: "id", type: "int", pk: true }],
        indexes: [],
        position: { x: 0, y: 0 },
        detailLevel: "standard",
      },
    ],
    refs: [],
    enums: [],
    zones: [],
    stickyNotes: [],
    tableGroups: [{ id: "g1", name: "core", tableIds: ["t1"] }],
  };
  const source = `
Table users {
  id int [pk]
}
`;
  const incoming = toProject(parseDbml(source), "Test");
  const merged = mergeProjectIntoExisting(existing, incoming);
  assert.equal(
    merged.tableGroups.length,
    0,
    "no TableGroup block in the source -> no group survives, same as any other DBML-native entity",
  );
});

test("composite unique index round-trips", () => {
  const source = `
Table memberships {
  user_id int
  org_id int

  indexes {
    (user_id, org_id) [unique, name: 'uq_membership']
  }
}
`;
  const project = toProject(parseDbml(source), "Test");
  const table = project.tables[0];
  assert.equal(table.indexes.length, 1);
  assert.equal(table.indexes[0].unique, true);
  assert.equal(table.indexes[0].fieldIds.length, 2);

  const dbml = projectToDbml(project);
  assert.match(dbml, /indexes \{/);
  assert.match(dbml, /\(user_id, org_id\)/);
  assert.match(dbml, /unique/);
});

test("composite primary key round-trips (both marking a 2+ column pk collapses to one composite index)", () => {
  const source = `
Table entreprise_admin {
  id_entreprise int [pk]
  id_user int [pk]
}
`;
  const project = toProject(parseDbml(source), "Test");
  const table = project.tables[0];
  // @dbml/core normalizes 2+ per-field [pk] markers into a single composite
  // index rather than leaving each field's own pk flag set — regression test
  // for the bug where that index's pk flag got dropped on import, silently
  // turning a composite primary key into an unmarked, invisible index.
  assert.equal(
    table.fields.every((f) => !f.pk),
    true,
  );
  assert.equal(table.indexes.length, 1);
  assert.equal(table.indexes[0].pk, true);
  assert.equal(table.indexes[0].fieldIds.length, 2);

  const dbml = projectToDbml(project);
  assert.match(dbml, /indexes \{/);
  assert.match(dbml, /\(id_entreprise, id_user\)/);
  assert.match(dbml, /pk/);

  const reimported = toProject(parseDbml(dbml), "Test");
  assert.equal(reimported.tables[0].indexes[0].pk, true);
});

test("identifiers with special characters get quoted and re-parse cleanly", () => {
  const project: Project = {
    id: "p1",
    name: "Test",
    tables: [
      {
        id: "t1",
        name: "user profile",
        fields: [{ id: "f1", name: "id", type: "int", pk: true }],
        indexes: [],
        position: { x: 0, y: 0 },
        detailLevel: "standard",
      },
    ],
    refs: [],
    enums: [],
    zones: [],
    stickyNotes: [],
    tableGroups: [],
  };
  const dbml = projectToDbml(project);
  assert.match(dbml, /Table "user profile"/);

  const reparsed = toProject(parseDbml(dbml), "Test");
  assert.equal(reparsed.tables[0].name, "user profile");
});

function projectWithVisuals(): Project {
  return {
    id: "p1",
    name: "Test",
    tables: [
      {
        id: "t1",
        name: "users",
        fields: [{ id: "f1", name: "id", type: "int", pk: true }],
        indexes: [],
        position: { x: 250, y: 60 },
        size: { width: 300, height: 150 },
        style: { color: "#123456", borderColor: "#abcdef" },
        detailLevel: "full",
      },
    ],
    refs: [],
    enums: [],
    zones: [{ id: "z1", label: "Core", position: { x: 0, y: 0 }, size: { width: 400, height: 300 } }],
    stickyNotes: [
      { id: "s1", text: "remember to index this", position: { x: 10, y: 10 }, size: { width: 120, height: 80 } },
    ],
    tableGroups: [],
  };
}

test("projectToDbml only appends the visual-metadata sidecar when opted in, and it doesn't break re-parsing", () => {
  const project = projectWithVisuals();

  const plain = projectToDbml(project);
  assert.doesNotMatch(plain, /athanordb:visual/, "sidecar absent by default (keeps the live DBML panel clean)");

  const withVisuals = projectToDbml(project, { includeVisualMetadata: true });
  assert.match(withVisuals, /\/\/ athanordb:visual /);

  // A plain `//` comment — @dbml/core should just ignore it like any other tool would.
  const reparsed = toProject(parseDbml(withVisuals), "Test");
  assert.equal(reparsed.tables[0].name, "users");
});

test("extractVisualMetadata reads the sidecar back out, and is nullish-safe for source without one", () => {
  const dbml = projectToDbml(projectWithVisuals(), { includeVisualMetadata: true });
  const meta = extractVisualMetadata(dbml);
  assert.ok(meta);
  assert.deepEqual(meta!.tables?.users?.position, { x: 250, y: 60 });
  assert.equal(meta!.zones?.length, 1);
  assert.equal(meta!.stickyNotes?.length, 1);

  assert.equal(extractVisualMetadata("Table users { id int [pk] }"), null, "no marker line -> null, not a throw");
  assert.equal(extractVisualMetadata("// athanordb:visual not-json"), null, "malformed JSON -> null, not a throw");
});

test("applyVisualMetadata restores position/style/detailLevel/zones/stickyNotes onto a freshly re-parsed project", () => {
  const original = projectWithVisuals();
  const dbml = projectToDbml(original, { includeVisualMetadata: true });

  // Simulates a `.dbml` file round-tripping through a brand-new project: no
  // `existing` state to merge against, just the plain parse plus the sidecar.
  const reparsed = toProject(parseDbml(dbml), "Test");
  const restored = applyVisualMetadata(reparsed, dbml);

  const users = restored.tables.find((t) => t.name === "users")!;
  assert.deepEqual(users.position, original.tables[0].position);
  assert.deepEqual(users.size, original.tables[0].size);
  assert.deepEqual(users.style, original.tables[0].style);
  assert.equal(users.detailLevel, "full");
  assert.deepEqual(restored.zones, original.zones);
  assert.deepEqual(restored.stickyNotes, original.stickyNotes);
});

test("mergeProjectIntoExisting: sidecar-restored position/zones seed a brand-new project, but never override an existing one's", () => {
  const original = projectWithVisuals();
  const dbml = projectToDbml(original, { includeVisualMetadata: true });
  const incoming = applyVisualMetadata(toProject(parseDbml(dbml), "Test"), dbml);

  const empty: Project = {
    id: "p1",
    name: "Test",
    tables: [],
    refs: [],
    enums: [],
    zones: [],
    stickyNotes: [],
    tableGroups: [],
  };
  const seeded = mergeProjectIntoExisting(empty, incoming);
  const seededUsers = seeded.tables.find((t) => t.name === "users")!;
  assert.deepEqual(
    seededUsers.position,
    original.tables[0].position,
    "brand-new project picks up the sidecar position",
  );
  assert.deepEqual(seeded.zones, original.zones, "brand-new project picks up sidecar zones");
  assert.deepEqual(seeded.stickyNotes, original.stickyNotes, "brand-new project picks up sidecar sticky notes");

  const existingWithOwnState: Project = {
    ...empty,
    tables: [{ ...original.tables[0], position: { x: 999, y: 999 }, style: undefined }],
    zones: [{ id: "existing-zone", label: "Mine", position: { x: 1, y: 1 }, size: { width: 10, height: 10 } }],
  };
  const merged = mergeProjectIntoExisting(existingWithOwnState, incoming);
  const mergedUsers = merged.tables.find((t) => t.name === "users")!;
  assert.deepEqual(mergedUsers.position, { x: 999, y: 999 }, "existing project's own position wins over the sidecar's");
  assert.deepEqual(merged.zones, existingWithOwnState.zones, "existing project's own zones win over the sidecar's");
});
