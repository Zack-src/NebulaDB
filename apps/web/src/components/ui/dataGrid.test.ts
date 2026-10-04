import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_AUTO_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  ariaSort,
  autoColumnWidth,
  clampWidth,
  compareCells,
  formatCell,
  nextSort,
  resolveWidths,
  scrollTopForKey,
  sortedRowOrder,
  visibleRange,
} from "./dataGrid";

describe("DataGrid sort", () => {
  it("walks ascending, descending, then unsorted on the same column", () => {
    const asc = nextSort(null, 2);
    assert.deepEqual(asc, { column: 2, direction: "asc" });
    const desc = nextSort(asc, 2);
    assert.deepEqual(desc, { column: 2, direction: "desc" });
    assert.equal(nextSort(desc, 2), null);
  });

  it("starts ascending again on another column", () => {
    assert.deepEqual(nextSort({ column: 2, direction: "desc" }, 0), { column: 0, direction: "asc" });
  });

  it("maps the sort onto aria-sort", () => {
    assert.equal(ariaSort(null, 0), "none");
    assert.equal(ariaSort({ column: 1, direction: "asc" }, 0), "none");
    assert.equal(ariaSort({ column: 1, direction: "asc" }, 1), "ascending");
    assert.equal(ariaSort({ column: 1, direction: "desc" }, 1), "descending");
  });

  it("compares numbers as numbers, not as text", () => {
    assert.ok(compareCells(9, 10) < 0);
    assert.ok(compareCells(-2, 1) < 0);
    assert.equal(compareCells(3, 3), 0);
  });

  it("compares numeric text as numbers — big integers and decimals arrive as strings", () => {
    assert.ok(compareCells("9", "10") < 0);
    assert.ok(compareCells("12.50", 13) < 0);
    assert.ok(compareCells("9007199254740993", "10") > 0);
  });

  it("puts numbers before other text, so a mixed column has one order", () => {
    assert.ok(compareCells(10, "abc") < 0);
    assert.ok(compareCells("abc", "9") > 0);
    assert.ok(compareCells("", 0) > 0, "an empty string is text, not zero");
  });

  it("compares text with the locale's alphabet", () => {
    assert.ok(compareCells("apple", "banana") < 0);
    assert.ok(compareCells(false, true) < 0);
  });

  it("keeps NULL last in both directions", () => {
    assert.ok(compareCells(null, 1, "asc") > 0);
    assert.ok(compareCells(null, 1, "desc") > 0);
    assert.ok(compareCells("z", null, "desc") < 0);
    assert.ok(compareCells(undefined, "a", "asc") > 0);
    assert.equal(compareCells(null, null, "desc"), 0);
  });

  it("orders rows without touching them", () => {
    const rows = [[3], [null], [10], ["2"], [null], [1]];
    const copy = structuredClone(rows);
    assert.deepEqual(sortedRowOrder(rows, null), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(sortedRowOrder(rows, { column: 0, direction: "asc" }), [5, 3, 0, 2, 1, 4]);
    assert.deepEqual(sortedRowOrder(rows, { column: 0, direction: "desc" }), [2, 0, 3, 5, 1, 4]);
    assert.deepEqual(rows, copy);
  });

  it("keeps the given order between rows that compare equal", () => {
    const rows = [
      ["b", 1],
      ["a", 2],
      ["b", 3],
      ["a", 4],
    ];
    assert.deepEqual(sortedRowOrder(rows, { column: 0, direction: "asc" }), [1, 3, 0, 2]);
    assert.deepEqual(sortedRowOrder(rows, { column: 0, direction: "desc" }), [0, 2, 1, 3]);
  });

  it("treats a column the rows do not have as all NULL", () => {
    assert.deepEqual(sortedRowOrder([[1], [2]], { column: 5, direction: "asc" }), [0, 1]);
  });
});

describe("DataGrid cells", () => {
  it("returns null for SQL NULL and text for everything else", () => {
    assert.equal(formatCell(null), null);
    assert.equal(formatCell(undefined), null);
    assert.equal(formatCell(""), "");
    assert.equal(formatCell(0), "0");
    assert.equal(formatCell(false), "false");
    assert.equal(formatCell("\\x00ff"), "\\x00ff");
  });

  it("prints a nested value as JSON", () => {
    assert.equal(formatCell({ a: 1 }), '{"a":1}');
    assert.equal(formatCell([1, null]), "[1,null]");
  });
});

describe("DataGrid visible range", () => {
  const base = { rowHeight: 20, rowCount: 10_000, overscan: 5 };

  it("renders the rows in view plus the overscan", () => {
    assert.deepEqual(visibleRange({ ...base, scrollTop: 0, viewportHeight: 200 }), { start: 0, end: 16 });
    assert.deepEqual(visibleRange({ ...base, scrollTop: 2000, viewportHeight: 200 }), { start: 95, end: 116 });
  });

  it("includes a row that is only partly in view", () => {
    assert.deepEqual(visibleRange({ ...base, overscan: 0, scrollTop: 30, viewportHeight: 40 }), { start: 1, end: 4 });
  });

  it("stops at the last row", () => {
    const range = visibleRange({ ...base, scrollTop: 199_800, viewportHeight: 200 });
    assert.deepEqual(range, { start: 9985, end: 10_000 });
  });

  it("stays within bounds when the scroll position is stale or negative", () => {
    assert.deepEqual(visibleRange({ ...base, rowCount: 3, scrollTop: 5000, viewportHeight: 200 }), {
      start: 0,
      end: 3,
    });
    assert.deepEqual(visibleRange({ ...base, scrollTop: -50, viewportHeight: 200 }), { start: 0, end: 16 });
  });

  it("renders nothing without rows", () => {
    assert.deepEqual(visibleRange({ ...base, rowCount: 0, scrollTop: 0, viewportHeight: 200 }), { start: 0, end: 0 });
  });

  it("never renders more than the view and twice the overscan, whatever the row count", () => {
    for (const scrollTop of [0, 1234, 99_999, 150_000]) {
      const { start, end } = visibleRange({ ...base, scrollTop, viewportHeight: 400 });
      assert.ok(end - start <= 400 / 20 + 1 + 2 * 5, `${end - start} rows at ${scrollTop}`);
    }
  });
});

describe("DataGrid widths", () => {
  it("clamps to the bounds and rounds", () => {
    assert.equal(clampWidth(10), MIN_COLUMN_WIDTH);
    assert.equal(clampWidth(99_999), MAX_COLUMN_WIDTH);
    assert.equal(clampWidth(120.6), 121);
    assert.equal(clampWidth(Number.NaN), MIN_COLUMN_WIDTH);
    assert.equal(clampWidth(500, 60, 300), 300);
  });

  it("sizes a column to its longest sampled value", () => {
    const rows = [["ab"], ["abcdefghij"], [null]];
    assert.equal(autoColumnWidth("id", rows, 0, { charWidth: 7, chrome: 30 }), 100);
  });

  it("makes room for the header and for the NULL label", () => {
    assert.equal(autoColumnWidth("a_long_header", [["x"]], 0, { charWidth: 7, chrome: 30 }), 13 * 7 + 30);
    assert.equal(autoColumnWidth("x", [[null]], 0, { charWidth: 10, chrome: 30 }), 70);
  });

  it("caps the automatic width and never goes under the minimum", () => {
    assert.equal(autoColumnWidth("t", [["x".repeat(5000)]], 0, { charWidth: 7, chrome: 30 }), MAX_AUTO_COLUMN_WIDTH);
    assert.equal(autoColumnWidth("", [], 0, { charWidth: 7, chrome: 10 }), MIN_COLUMN_WIDTH);
  });

  it("only measures the sample", () => {
    const rows = [["a"], ["a"], ["a much longer value"]];
    assert.equal(autoColumnWidth("c", rows, 0, { charWidth: 7, chrome: 43, sampleSize: 2 }), 50);
  });

  it("uses the caller's widths where they are usable", () => {
    assert.deepEqual(resolveWidths([100, 120, 140], undefined), [100, 120, 140]);
    assert.deepEqual(resolveWidths([100, 120, 140], [200]), [200, 120, 140]);
    assert.deepEqual(resolveWidths([100, 120], [5, Number.NaN, 300]), [MIN_COLUMN_WIDTH, 120]);
  });
});

describe("DataGrid keyboard scrolling", () => {
  const state = { scrollTop: 400, viewportHeight: 200, rowHeight: 20, rowCount: 1000 };

  it("moves by one row with the arrows", () => {
    assert.equal(scrollTopForKey("ArrowDown", state), 420);
    assert.equal(scrollTopForKey("ArrowUp", state), 380);
  });

  it("moves by a page less one row, so the last row read stays in view", () => {
    assert.equal(scrollTopForKey("PageDown", state), 580);
    assert.equal(scrollTopForKey("PageUp", state), 220);
  });

  it("goes to either end and stays within them", () => {
    assert.equal(scrollTopForKey("Home", state), 0);
    assert.equal(scrollTopForKey("End", state), 19_800);
    assert.equal(scrollTopForKey("ArrowUp", { ...state, scrollTop: 0 }), 0);
    assert.equal(scrollTopForKey("PageDown", { ...state, scrollTop: 19_790 }), 19_800);
  });

  it("ignores the other keys", () => {
    assert.equal(scrollTopForKey("Enter", state), null);
    assert.equal(scrollTopForKey("a", state), null);
  });
});
