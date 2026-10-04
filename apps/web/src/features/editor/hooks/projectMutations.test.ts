import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { getRefsMap, readProjectFromDoc, writeProjectToDoc, type Project, type Table } from "@athanordb/shared";
import { createProjectMutations } from "@/features/editor/hooks/projectMutations";

const table = (id: string, fields: string[]): Table => ({
  id,
  name: id,
  fields: fields.map((name) => ({ id: `${id}.${name}`, name, type: "integer", pk: name === "id" })),
  indexes: [],
  position: { x: 0, y: 0 },
  detailLevel: "standard",
});

/** users ← orders (orders carries the key), plus a free `notes` table. */
function setup(frozen: string[]) {
  const doc = new Y.Doc();
  const project: Project = {
    id: "p",
    name: "Shop",
    tables: [table("users", ["id"]), table("orders", ["id", "user_id"]), table("notes", ["id", "order_id"])],
    refs: [
      {
        id: "r-orders-users",
        from: { tableId: "orders", fieldId: "orders.user_id" },
        to: { tableId: "users", fieldId: "users.id" },
        cardinality: "one-to-many",
      },
      {
        id: "r-notes-orders",
        from: { tableId: "notes", fieldId: "notes.order_id" },
        to: { tableId: "orders", fieldId: "orders.id" },
        cardinality: "one-to-many",
      },
    ],
    enums: [],
    zones: [],
    stickyNotes: [],
    tableGroups: [],
  };
  writeProjectToDoc(doc, project);
  const refused: string[] = [];
  const mutations = createProjectMutations(
    () => readProjectFromDoc(doc, "p", "Shop"),
    () => doc,
    () => [],
    { frozenTableIds: () => new Set(frozen), onLockedRelation: (name) => refused.push(name) },
  );
  const refIds = () => [...getRefsMap(doc).keys()].sort();
  return { doc, mutations, refused, refIds };
}

const connection = (source: string, sourceField: string, target: string, targetField: string) => ({
  source,
  target,
  sourceHandle: `${source}.${sourceField}-right-source`,
  targetHandle: `${target}.${targetField}-left-target`,
});

test("deleting relations leaves the ones a locked table carries, and says so", () => {
  const { mutations, refused, refIds } = setup(["orders"]);
  mutations.deleteEdges(["r-orders-users", "r-notes-orders"]);
  // `orders` carries the first; the second only points at it — that key is `notes`'s.
  assert.deepEqual(refIds(), ["r-orders-users"]);
  assert.deepEqual(refused, ["orders"]);
});

test("a relation cannot be drawn onto a locked table's column, whichever way it is dragged", () => {
  const { mutations, refused, refIds } = setup(["notes"]);
  const before = refIds();
  // From the plain column to the key, and from the key to the plain column: both make `notes` carry it.
  mutations.onConnect(connection("notes", "order_id", "users", "id"));
  mutations.onConnect(connection("users", "id", "notes", "order_id"));
  assert.deepEqual(refIds(), before);
  assert.deepEqual(refused, ["notes", "notes"]);
});

test("a relation pointing at a locked table is another table's business", () => {
  const { doc, mutations, refused } = setup(["users"]);
  mutations.onConnect(connection("notes", "order_id", "users", "id"));
  assert.deepEqual(refused, []);
  const created = [...getRefsMap(doc).values()].find(
    (ref) => ref.from.tableId === "notes" && ref.to.tableId === "users",
  );
  assert.ok(created, "the foreign key is on `notes`, which is free");
  mutations.deleteEdges(["r-orders-users"]);
  assert.equal(getRefsMap(doc).has("r-orders-users"), false);
});

test("without locks nothing is refused", () => {
  const { mutations, refused, refIds } = setup([]);
  mutations.deleteEdges(["r-orders-users", "r-notes-orders"]);
  assert.deepEqual(refIds(), []);
  assert.deepEqual(refused, []);
});
