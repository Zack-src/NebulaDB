import { test } from "node:test";
import assert from "node:assert/strict";
import type { Field, Project, Ref, Table } from "./schema.js";
import { isRefInverted, normalizeRefOrientation } from "./refOrientation.js";

function field(id: string, extra: Partial<Field> = {}): Field {
  return { id, name: id, type: "int", ...extra };
}

function table(id: string, fields: Field[], indexes: Table["indexes"] = []): Table {
  return { id, name: id, fields, indexes, position: { x: 0, y: 0 }, detailLevel: "full" };
}

function ref(from: [string, string], to: [string, string], cardinality: Ref["cardinality"] = "one-to-many"): Ref {
  return {
    id: `${from.join(".")}-${to.join(".")}`,
    from: { tableId: from[0], fieldId: from[1] },
    to: { tableId: to[0], fieldId: to[1] },
    cardinality,
  };
}

const tables = [
  table("users", [field("users.id", { pk: true }), field("users.email", { unique: true })]),
  table("posts", [field("posts.id", { pk: true }), field("posts.author_id")]),
  table(
    "post_tags",
    [field("post_tags.post_id"), field("post_tags.tag_id")],
    [{ id: "pk", fieldIds: ["post_tags.post_id", "post_tags.tag_id"], pk: true }],
  ),
  table("subs", [field("subs.id", { pk: true }), field("subs.org_id", { unique: true })]),
  table("orgs", [field("orgs.id", { pk: true })]),
];
const byId = new Map(tables.map((t) => [t.id, t]));

test("one-to-many stored from the referenced key to the FK column is inverted", () => {
  assert.equal(isRefInverted(ref(["users", "users.id"], ["posts", "posts.author_id"]), byId), true);
  assert.equal(isRefInverted(ref(["posts", "posts.author_id"], ["users", "users.id"]), byId), false);
});

test("a column in a composite PK isn't a key on its own — junction tables are oriented correctly", () => {
  assert.equal(isRefInverted(ref(["posts", "posts.id"], ["post_tags", "post_tags.post_id"]), byId), true);
  assert.equal(isRefInverted(ref(["post_tags", "post_tags.post_id"], ["posts", "posts.id"]), byId), false);
});

test("ambiguous shapes are left alone: key-to-key one-to-many, and many-to-many", () => {
  assert.equal(isRefInverted(ref(["users", "users.id"], ["users", "users.email"]), byId), false);
  assert.equal(isRefInverted(ref(["users", "users.id"], ["posts", "posts.author_id"], "many-to-many"), byId), false);
});

test("one-to-one: PK → unique non-PK is the inverted shape; the reverse is fine", () => {
  assert.equal(isRefInverted(ref(["orgs", "orgs.id"], ["subs", "subs.org_id"], "one-to-one"), byId), true);
  assert.equal(isRefInverted(ref(["subs", "subs.org_id"], ["orgs", "orgs.id"], "one-to-one"), byId), false);
});

test("normalizeRefOrientation flips only what's inverted, reverses waypoints, and is idempotent", () => {
  const inverted = {
    ...ref(["users", "users.id"], ["posts", "posts.author_id"]),
    routingPoints: [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ],
  };
  const fine = ref(["post_tags", "post_tags.post_id"], ["posts", "posts.id"]);
  const project: Project = {
    id: "p",
    name: "p",
    tables,
    refs: [inverted, fine],
    enums: [],
    zones: [],
    stickyNotes: [],
    tableGroups: [],
  };

  const normalized = normalizeRefOrientation(project);
  assert.deepEqual(normalized.refs[0].from, { tableId: "posts", fieldId: "posts.author_id" });
  assert.deepEqual(normalized.refs[0].routingPoints, [
    { x: 2, y: 2 },
    { x: 1, y: 1 },
  ]);
  assert.equal(normalized.refs[1], fine, "an untouched ref keeps its identity");
  assert.equal(normalizeRefOrientation(normalized), normalized, "nothing left to flip → same object");
});
