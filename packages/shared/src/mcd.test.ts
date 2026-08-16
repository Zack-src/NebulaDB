import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveMCD } from "./mcd.js";
import type { Field, Project, Ref, Table } from "./schema.js";

function field(overrides: Partial<Field> & { id: string; name: string; type: string }): Field {
  return overrides;
}

function table(overrides: Partial<Table> & { id: string; name: string; fields: Field[] }): Table {
  return { indexes: [], position: { x: 0, y: 0 }, detailLevel: "standard", ...overrides };
}

function ref(overrides: Partial<Ref> & Pick<Ref, "id" | "from" | "to" | "cardinality">): Ref {
  return overrides;
}

function project(overrides: Partial<Project> & { tables: Table[]; refs: Ref[] }): Project {
  return {
    id: "p1",
    name: "test",
    enums: [],
    zones: [],
    stickyNotes: [],
    tableGroups: [],
    ...overrides,
  };
}

test("plain table with no refs becomes an entity with all its fields as attributes", () => {
  const users = table({
    id: "users",
    name: "users",
    fields: [
      field({ id: "u.id", name: "id", type: "int", pk: true }),
      field({ id: "u.name", name: "name", type: "varchar" }),
    ],
  });
  const model = deriveMCD(project({ tables: [users], refs: [] }));

  assert.equal(model.entities.length, 1);
  assert.equal(model.associations.length, 0);
  assert.equal(model.warnings.length, 0);
  assert.deepEqual(
    model.entities[0].attributes.map((a) => a.name),
    ["id", "name"],
  );
});

test("a plain one-to-many ref becomes a binary association, FK column dropped from the child entity", () => {
  const users = table({
    id: "users",
    name: "users",
    fields: [field({ id: "u.id", name: "id", type: "int", pk: true })],
  });
  const posts = table({
    id: "posts",
    name: "posts",
    fields: [
      field({ id: "p.id", name: "id", type: "int", pk: true }),
      field({ id: "p.user_id", name: "user_id", type: "int", notNull: true }),
      field({ id: "p.title", name: "title", type: "varchar" }),
    ],
  });
  const r = ref({
    id: "r1",
    from: { tableId: "users", fieldId: "u.id" },
    to: { tableId: "posts", fieldId: "p.user_id" },
    cardinality: "one-to-many",
  });
  const model = deriveMCD(project({ tables: [users, posts], refs: [r] }));

  assert.equal(model.entities.length, 2);
  const postsEntity = model.entities.find((e) => e.id === "posts")!;
  assert.deepEqual(
    postsEntity.attributes.map((a) => a.name),
    ["id", "title"], // user_id dropped — it's represented by the association
  );

  assert.equal(model.associations.length, 1);
  const assoc = model.associations[0];
  assert.equal(assoc.sourceId, "r1");
  const usersMember = assoc.members.find((m) => m.entityId === "users")!;
  const postsMember = assoc.members.find((m) => m.entityId === "posts")!;
  assert.equal(usersMember.cardinality, "0,n");
  assert.equal(postsMember.cardinality, "1,1"); // FK is NOT NULL
});

test("a nullable FK yields 0,1 on the child side instead of 1,1", () => {
  const a = table({ id: "a", name: "a", fields: [field({ id: "a.id", name: "id", type: "int", pk: true })] });
  const b = table({
    id: "b",
    name: "b",
    fields: [
      field({ id: "b.id", name: "id", type: "int", pk: true }),
      field({ id: "b.a_id", name: "a_id", type: "int" }), // nullable
    ],
  });
  const r = ref({
    id: "r1",
    from: { tableId: "a", fieldId: "a.id" },
    to: { tableId: "b", fieldId: "b.a_id" },
    cardinality: "one-to-many",
  });
  const model = deriveMCD(project({ tables: [a, b], refs: [r] }));
  const bMember = model.associations[0].members.find((m) => m.entityId === "b")!;
  assert.equal(bMember.cardinality, "0,1");
});

test("a junction table (composite PK of exactly 2 FKs) collapses into an n,n association", () => {
  const posts = table({ id: "posts", name: "posts", fields: [field({ id: "posts.id", name: "id", type: "int", pk: true })] });
  const tags = table({ id: "tags", name: "tags", fields: [field({ id: "tags.id", name: "id", type: "int", pk: true })] });
  const postTags = table({
    id: "post_tags",
    name: "post_tags",
    fields: [
      field({ id: "pt.post_id", name: "post_id", type: "int", notNull: true }),
      field({ id: "pt.tag_id", name: "tag_id", type: "int", notNull: true }),
      field({ id: "pt.added_at", name: "added_at", type: "timestamp" }),
    ],
    indexes: [{ id: "idx1", fieldIds: ["pt.post_id", "pt.tag_id"], pk: true }],
  });
  const r1 = ref({
    id: "r1",
    from: { tableId: "posts", fieldId: "posts.id" },
    to: { tableId: "post_tags", fieldId: "pt.post_id" },
    cardinality: "one-to-many",
  });
  const r2 = ref({
    id: "r2",
    from: { tableId: "tags", fieldId: "tags.id" },
    to: { tableId: "post_tags", fieldId: "pt.tag_id" },
    cardinality: "one-to-many",
  });
  const model = deriveMCD(project({ tables: [posts, tags, postTags], refs: [r1, r2] }));

  // The join table disappears as an entity...
  assert.equal(model.entities.length, 2);
  assert.ok(!model.entities.some((e) => e.id === "post_tags"));

  // ...and becomes a single n,n association carrying its leftover column as an attribute.
  assert.equal(model.associations.length, 1);
  const assoc = model.associations[0];
  assert.equal(assoc.name, "post_tags");
  assert.deepEqual(
    assoc.members.map((m) => m.cardinality).sort(),
    ["0,n", "0,n"],
  );
  assert.deepEqual(
    assoc.attributes.map((a) => a.name),
    ["added_at"],
  );
  assert.equal(model.warnings.length, 0);
});

test("a table with 3 FKs entirely composing its PK is flagged as a possible ternary association, not converted", () => {
  const a = table({ id: "a", name: "a", fields: [field({ id: "a.id", name: "id", type: "int", pk: true })] });
  const b = table({ id: "b", name: "b", fields: [field({ id: "b.id", name: "id", type: "int", pk: true })] });
  const c = table({ id: "c", name: "c", fields: [field({ id: "c.id", name: "id", type: "int", pk: true })] });
  const junction = table({
    id: "j",
    name: "j",
    fields: [
      field({ id: "j.a_id", name: "a_id", type: "int", notNull: true }),
      field({ id: "j.b_id", name: "b_id", type: "int", notNull: true }),
      field({ id: "j.c_id", name: "c_id", type: "int", notNull: true }),
    ],
    indexes: [{ id: "idx1", fieldIds: ["j.a_id", "j.b_id", "j.c_id"], pk: true }],
  });
  const refs = [
    ref({ id: "r1", from: { tableId: "a", fieldId: "a.id" }, to: { tableId: "j", fieldId: "j.a_id" }, cardinality: "one-to-many" }),
    ref({ id: "r2", from: { tableId: "b", fieldId: "b.id" }, to: { tableId: "j", fieldId: "j.b_id" }, cardinality: "one-to-many" }),
    ref({ id: "r3", from: { tableId: "c", fieldId: "c.id" }, to: { tableId: "j", fieldId: "j.c_id" }, cardinality: "one-to-many" }),
  ];
  const model = deriveMCD(project({ tables: [a, b, c, junction], refs }));

  // Left as a plain entity rather than guessed at.
  assert.ok(model.entities.some((e) => e.id === "j"));
  assert.equal(model.warnings.length, 1);
  assert.equal(model.warnings[0].reason, "possible-ternary-association");
});

test("a self-referencing FK produces a reflexive association with both members on the same entity", () => {
  const employees = table({
    id: "employees",
    name: "employees",
    fields: [
      field({ id: "e.id", name: "id", type: "int", pk: true }),
      field({ id: "e.manager_id", name: "manager_id", type: "int" }),
    ],
  });
  const r = ref({
    id: "r1",
    from: { tableId: "employees", fieldId: "e.id" },
    to: { tableId: "employees", fieldId: "e.manager_id" },
    cardinality: "one-to-many",
  });
  const model = deriveMCD(project({ tables: [employees], refs: [r] }));

  assert.equal(model.associations.length, 1);
  assert.ok(model.associations[0].members.every((m) => m.entityId === "employees"));
});

test("many-to-many ref without a physical junction table becomes a direct n,n association", () => {
  const students = table({ id: "students", name: "students", fields: [field({ id: "s.id", name: "id", type: "int", pk: true })] });
  const courses = table({ id: "courses", name: "courses", fields: [field({ id: "c.id", name: "id", type: "int", pk: true })] });
  const r = ref({
    id: "r1",
    from: { tableId: "students", fieldId: "s.id" },
    to: { tableId: "courses", fieldId: "c.id" },
    cardinality: "many-to-many",
  });
  const model = deriveMCD(project({ tables: [students, courses], refs: [r] }));

  assert.equal(model.entities.length, 2);
  assert.equal(model.associations.length, 1);
  assert.deepEqual(
    model.associations[0].members.map((m) => m.cardinality),
    ["0,n", "0,n"],
  );
});

test("a surrogate-keyed entity with 2 unrelated FKs to the same table is NOT flagged — it's a plain entity, not a junction table", () => {
  // Regression: `Scenario_Comparaison` from a real schema — its own `id` PK
  // has no overlap at all with `id_scenario_1`/`id_scenario_2`, so this
  // should produce 2 ordinary binary associations and zero warnings.
  const scenario = table({ id: "scenario", name: "Scenario", fields: [field({ id: "sc.id", name: "id", type: "int", pk: true })] });
  const comparaison = table({
    id: "comparaison",
    name: "Scenario_Comparaison",
    fields: [
      field({ id: "cmp.id", name: "id", type: "int", pk: true }),
      field({ id: "cmp.s1", name: "id_scenario_1", type: "int" }),
      field({ id: "cmp.s2", name: "id_scenario_2", type: "int" }),
    ],
  });
  const refs = [
    ref({
      id: "r1",
      from: { tableId: "scenario", fieldId: "sc.id" },
      to: { tableId: "comparaison", fieldId: "cmp.s1" },
      cardinality: "one-to-many",
    }),
    ref({
      id: "r2",
      from: { tableId: "scenario", fieldId: "sc.id" },
      to: { tableId: "comparaison", fieldId: "cmp.s2" },
      cardinality: "one-to-many",
    }),
  ];
  const model = deriveMCD(project({ tables: [scenario, comparaison], refs }));

  assert.equal(model.warnings.length, 0);
  assert.ok(model.entities.some((e) => e.id === "comparaison"));
  assert.equal(model.associations.length, 2);
  const comparaisonEntity = model.entities.find((e) => e.id === "comparaison")!;
  assert.deepEqual(
    comparaisonEntity.attributes.map((a) => a.name),
    ["id"], // both FK columns dropped, represented by the 2 associations instead
  );
});

test("a ref written with the FK on the `from` side (reversed declaration order) still resolves the FK by its own PK, not by from/to position", () => {
  // Regression: a real schema had `Scenario.id > Scenario_Comparaison.id_scenario_1/2`
  // (from = parent) *and* `Other.other_id > Scenario_Comparaison.id` (from =
  // child here — `other_id` is a plain FK column, `Scenario_Comparaison.id`
  // is the referenced PK). Resolving direction from `ref.to` unconditionally
  // wrongly treated `Scenario_Comparaison.id` as an outgoing FK of its own
  // table, breaking the PK/FK overlap check used above.
  const scenario = table({ id: "scenario", name: "Scenario", fields: [field({ id: "sc.id", name: "id", type: "int", pk: true })] });
  const comparaison = table({
    id: "comparaison",
    name: "Scenario_Comparaison",
    fields: [
      field({ id: "cmp.id", name: "id", type: "int", pk: true }),
      field({ id: "cmp.s1", name: "id_scenario_1", type: "int" }),
      field({ id: "cmp.s2", name: "id_scenario_2", type: "int" }),
    ],
  });
  const other = table({
    id: "other",
    name: "Other",
    fields: [
      field({ id: "o.id", name: "id", type: "int", pk: true }),
      field({ id: "o.other_id", name: "other_id", type: "int" }),
    ],
  });
  const refs = [
    ref({ id: "r1", from: { tableId: "scenario", fieldId: "sc.id" }, to: { tableId: "comparaison", fieldId: "cmp.s1" }, cardinality: "one-to-many" }),
    ref({ id: "r2", from: { tableId: "scenario", fieldId: "sc.id" }, to: { tableId: "comparaison", fieldId: "cmp.s2" }, cardinality: "one-to-many" }),
    // Declared backwards: the FK (`other.other_id`) is on `from`, the referenced PK (`comparaison.id`) is on `to`.
    ref({ id: "r3", from: { tableId: "other", fieldId: "o.other_id" }, to: { tableId: "comparaison", fieldId: "cmp.id" }, cardinality: "one-to-many" }),
  ];
  const model = deriveMCD(project({ tables: [scenario, comparaison, other], refs }));

  assert.equal(model.warnings.length, 0);
  const comparaisonEntity = model.entities.find((e) => e.id === "comparaison")!;
  // `id` (its own PK, referenced by r3) must stay — it's not an outgoing FK of `comparaison`.
  assert.deepEqual(
    comparaisonEntity.attributes.map((a) => a.name),
    ["id"],
  );
  // `other` loses `other_id` — that's the actual FK column.
  const otherEntity = model.entities.find((e) => e.id === "other")!;
  assert.deepEqual(
    otherEntity.attributes.map((a) => a.name),
    ["id"],
  );
  assert.equal(model.associations.length, 3);
  const r3Assoc = model.associations.find((a) => a.sourceId === "r3")!;
  const comparaisonMember = r3Assoc.members.find((m) => m.entityId === "comparaison")!;
  const otherMember = r3Assoc.members.find((m) => m.entityId === "other")!;
  assert.equal(comparaisonMember.cardinality, "0,n"); // parent side
  assert.equal(otherMember.cardinality, "0,1"); // child/FK side, nullable
});
