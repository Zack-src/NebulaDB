import { test } from "node:test";
import assert from "node:assert/strict";
import type { Field, Project, Ref, Table } from "@nebuladb/shared";
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

test("a hand-written position or size cannot inject markup into the SVG", () => {
  const evil = table("users", [field("id")]);
  (evil.position as { x: unknown }).x = '0"/><script>alert(1)</script><rect x="';
  evil.size = { width: '1" onload="x' as unknown as number, height: Number.NaN };
  const svg = projectToSvg(project([evil]));

  assert.doesNotMatch(svg, /<script|onload/);
});

test("draws the colours chosen on the canvas: table header and border, ref", () => {
  const users = table("users", [field("id", { pk: true })], 0, 0);
  users.style = { color: "#7c3aed", borderColor: "#22c55e" };
  const light = table("light", [field("id")], 400, 0);
  light.style = { color: "#fde68a" };
  const ref: Ref = {
    id: "r1",
    from: { tableId: light.id, fieldId: light.fields[0].id },
    to: { tableId: users.id, fieldId: users.fields[0].id },
    cardinality: "one-to-many",
    style: { color: "#ef4444" },
  };
  const svg = projectToSvg(project([users, light], [ref]));

  assert.match(svg, /height="32" fill="#7c3aed"/, "header colour");
  assert.match(svg, /stroke="#22c55e"/, "border colour");
  assert.match(svg, /stroke="#ef4444"/, "ref colour");
  // A light header gets dark text, as on the canvas.
  assert.match(svg, /font-weight="bold" fill="#0f172a">light</);
  assert.match(svg, /font-weight="bold" fill="#f8fafc">users</);
});

test("draws the zones behind the tables, with their colour and label, and fits them in the frame", () => {
  const users = table("users", [field("id")], 100, 100);
  const svg = projectToSvg({
    ...project([users]),
    zones: [
      {
        id: "z1",
        label: "Billing",
        position: { x: 0, y: 0 },
        size: { width: 3000, height: 900 },
        style: { color: "#3b82f6" },
      },
      { id: "z2", label: "Default", position: { x: 50, y: 50 }, size: { width: 100, height: 100 } },
    ],
  });

  assert.match(svg, /fill="#3b82f6" fill-opacity="0.12"/);
  assert.match(svg, />Billing</);
  assert.match(svg, /fill="#f59e0b" fill-opacity="0.12"/, "a zone without a colour gets the canvas's default");
  assert.ok(svg.indexOf("Billing") < svg.indexOf(">users<"), "zones are drawn first, under the tables");
  const [, width] = svg.match(/viewBox="0 0 (\d+) (\d+)"/)!;
  assert.ok(Number(width) >= 3000, "the frame takes the zone in");
});

test("a hand-written colour or zone cannot inject markup into the SVG", () => {
  const users = table("users", [field("id")]);
  users.style = { color: '#fff" onload="alert(1)', borderColor: "red;}</style><script>" };
  const svg = projectToSvg({
    ...project([users]),
    zones: [
      {
        id: "z",
        label: "<script>x</script>",
        position: { x: '0"/><script>' as unknown as number, y: 0 },
        size: { width: 10, height: 10 },
        style: { color: "javascript:alert(1)" },
      },
    ],
  });
  assert.doesNotMatch(svg, /<script|onload|javascript:/);
  assert.match(svg, /fill="#1e293b"/, "an invalid colour falls back to the default");
});
