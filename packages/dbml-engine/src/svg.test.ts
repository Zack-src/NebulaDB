import { test } from "node:test";
import assert from "node:assert/strict";
import type { Field, Project, Ref, Table } from "@athanordb/shared";
import { projectToSvg } from "./svg.js";

function field(name: string, extra: Partial<Field> = {}): Field {
  return { id: `f-${name}`, name, type: "int", ...extra };
}

function table(name: string, fields: Field[], x = 0, y = 0): Table {
  return { id: `t-${name}`, name, fields, indexes: [], position: { x, y }, detailLevel: "standard" };
}

function project(tables: Table[], refs: Ref[] = []): Project {
  return { id: "p1", name: "Test", tables, refs, enums: [], zones: [], stickyNotes: [], tableGroups: [] };
}

test("renders an empty project as a valid, non-throwing empty SVG", () => {
  const svg = projectToSvg(project([]));
  assert.match(svg, /^<svg /);
  assert.match(svg, /<\/svg>$/);
});

test("renders one <g> table block per table, with its name and fields", () => {
  const users = table("users", [field("id", { pk: true }), field("email", { type: "varchar" })]);
  const svg = projectToSvg(project([users]));

  assert.match(svg, /users/);
  assert.match(svg, /id : int \[pk\]/);
  assert.match(svg, /email : varchar/);
});

test("escapes table/field names so untrusted schema content can't break out of the SVG markup", () => {
  const evil = table("<script>alert(1)</script>", [field('a"b')]);
  const svg = projectToSvg(project([evil]));

  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&lt;script&gt;/);
});

test("draws a line + cardinality labels for a ref between two known tables", () => {
  const users = table("users", [field("id", { pk: true })], 0, 0);
  const orders = table("orders", [field("id", { pk: true }), field("user_id")], 400, 0);
  const ref: Ref = {
    id: "r1",
    from: { tableId: users.id, fieldId: users.fields[0].id },
    to: { tableId: orders.id, fieldId: orders.fields[1].id },
    cardinality: "one-to-many",
  };
  const svg = projectToSvg(project([users, orders], [ref]));

  assert.match(svg, /<line /);
  assert.match(svg, />1<\/text>/);
  assert.match(svg, />n<\/text>/);
});

test("silently skips a ref pointing at a table that no longer exists, rather than throwing", () => {
  const users = table("users", [field("id")]);
  const ref: Ref = {
    id: "r1",
    from: { tableId: users.id, fieldId: users.fields[0].id },
    to: { tableId: "gone", fieldId: "gone-field" },
    cardinality: "one-to-one",
  };
  assert.doesNotThrow(() => projectToSvg(project([users], [ref])));
});

test("viewBox bounding box grows to fit tables placed far from the origin", () => {
  const near = table("near", [field("id")], 0, 0);
  const far = table("far", [field("id")], 2000, 1500);
  const svg = projectToSvg(project([near, far]));

  const viewBoxMatch = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  assert.ok(viewBoxMatch, "expected a viewBox attribute");
  const [, width, height] = viewBoxMatch!;
  assert.ok(Number(width) > 2000, "width should extend past the farthest table's x position");
  assert.ok(Number(height) > 1500, "height should extend past the farthest table's y position");
});
