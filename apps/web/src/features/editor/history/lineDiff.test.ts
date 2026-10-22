import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { diffRows, foldUnchanged } from "./lineDiff";

const kinds = (before: string, after: string) => diffRows(before, after).map((row) => row.kind);

describe("diffRows", () => {
  it("reports no change for equal texts", () => {
    assert.deepEqual(kinds("a\nb\nc", "a\nb\nc"), ["same", "same", "same"]);
  });

  it("pairs a line that disappears with the one that takes its place as a modification", () => {
    const rows = diffRows("Table t {\n  id int\n}", "Table t {\n  id bigint\n}");
    assert.deepEqual(
      rows.map((row) => row.kind),
      ["same", "changed", "same"],
    );
    assert.deepEqual(rows[1].before, { line: 2, text: "  id int", mark: { from: 5, to: 5 } });
    assert.deepEqual(rows[1].after, { line: 2, text: "  id bigint", mark: { from: 5, to: 8 } });
  });

  it("keeps the line numbers of each side", () => {
    const rows = diffRows("a\nb\nc", "a\nx\ny\nb\nc");
    assert.deepEqual(
      rows.map((row) => row.kind),
      ["same", "added", "added", "same", "same"],
    );
    assert.deepEqual(
      rows.map((row) => [row.before?.line, row.after?.line]),
      [
        [1, 1],
        [undefined, 2],
        [undefined, 3],
        [2, 4],
        [3, 5],
      ],
    );
  });

  it("reports additions and removals that have no partner", () => {
    assert.deepEqual(kinds("a\nb\nc\nd", "a\nd"), ["same", "removed", "removed", "same"]);
    assert.deepEqual(kinds("a\nd", "a\nb\nc\nd"), ["same", "added", "added", "same"]);
  });

  it("handles an empty side", () => {
    assert.deepEqual(kinds("", "a\nb"), ["removed", "added", "added"]);
    assert.deepEqual(kinds("a\nb", ""), ["removed", "removed", "added"]);
  });

  it("finds the shortest script around a line that moved out and another that came in", () => {
    const rows = diffRows("a\nb\nc\nd\ne\nf", "a\nc\nd\nx\ne\nf");
    assert.deepEqual(
      rows.map((row) => row.kind),
      ["same", "removed", "same", "same", "added", "same", "same"],
    );
  });

  it("does not pair lines that have nothing in common", () => {
    const rows = diffRows("Table t {\n  id int\n  legacy int\n}", "Table t {\n  id bigint\n}\n\nTable u {\n}");
    assert.ok(rows.some((row) => row.kind === "removed" && row.before?.text === "  legacy int"));
    assert.ok(rows.some((row) => row.kind === "changed" && row.before?.text === "  id int"));
  });

  it("finds the partner of a line among new ones", () => {
    const rows = diffRows("a\n  id int\nz", "a\nnew one\nnew two\n  id bigint\nz");
    assert.deepEqual(
      rows.map((row) => row.kind),
      ["same", "added", "added", "changed", "same"],
    );
  });

  it("rebuilds both texts from its rows", () => {
    const before = "t1\nt2\nt3\nt4\nt5\nt6\nt7";
    const after = "t0\nt2\nt3x\nt4\nt6\nt7\nt8";
    const rows = diffRows(before, after);
    assert.equal(rows.flatMap((row) => (row.before ? [row.before.text] : [])).join("\n"), before);
    assert.equal(rows.flatMap((row) => (row.after ? [row.after.text] : [])).join("\n"), after);
  });
});

describe("foldUnchanged", () => {
  it("keeps the context around a change and folds the rest", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 10", "line ten");
    const items = foldUnchanged(diffRows(before, after), 2);
    assert.deepEqual(
      items.map((item) => (item.kind === "gap" ? `gap ${item.hidden}` : item.kind)),
      ["gap 8", "same", "same", "changed", "same", "same", "gap 7"],
    );
  });

  it("folds nothing when everything changed", () => {
    assert.ok(foldUnchanged(diffRows("a", "b")).every((item) => item.kind !== "gap"));
  });
});
