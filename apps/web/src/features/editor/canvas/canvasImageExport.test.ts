import assert from "node:assert/strict";
import { test } from "node:test";
import { exportFrame, exportPixelRatio } from "./canvasImageExport";

test("a diagram is exported at its own size plus a margin, wherever it sits on the canvas", () => {
  assert.deepEqual(exportFrame({ x: -120.4, y: 300.2, width: 1000.5, height: 500 }), {
    x: -169,
    y: 252,
    width: 1097,
    height: 596,
  });
});

test("a raster export gets two device pixels per canvas pixel", () => {
  assert.equal(exportPixelRatio(2000, 1200), 2);
});

test("a very large diagram is exported at a lower ratio, within the browser's canvas limits", () => {
  const wide = exportPixelRatio(20_000, 3000);
  assert.ok(wide < 1 && 20_000 * wide <= 16_000, `wide: ${wide}`);
  const huge = exportPixelRatio(12_000, 12_000);
  assert.ok(12_000 * huge * 12_000 * huge <= 120_000_000 + 1, `huge: ${huge}`);
  assert.equal(exportPixelRatio(1_000_000, 1_000_000), 0.25, "never below a floor");
});
