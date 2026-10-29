import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_SCALE, MIN_SCALE, fitView, panBy, svgSize, zoomAt } from "./panZoom";
import { shareTokenFromPath } from "./publicShareApi";
import { shareUrl } from "@/services/shareLinksApi";

test("fitView centres the whole picture and never enlarges it", () => {
  assert.deepEqual(fitView({ width: 400, height: 200 }, { width: 1000, height: 800 }), { x: 300, y: 300, scale: 1 });
  const big = fitView({ width: 2000, height: 1000 }, { width: 1048, height: 548 });
  assert.equal(big.scale, 0.5);
  assert.equal(big.x, (1048 - 1000) / 2);
  assert.equal(big.y, (548 - 500) / 2);
  assert.deepEqual(fitView({ width: 0, height: 0 }, { width: 100, height: 100 }), { x: 0, y: 0, scale: 1 });
});

test("zoomAt keeps the point under the pointer still, within the scale bounds", () => {
  const view = { x: 10, y: 20, scale: 1 };
  const point = { x: 110, y: 220 };
  const zoomed = zoomAt(view, 2, point);
  assert.equal(zoomed.scale, 2);
  // The content point under the pointer before and after is the same.
  assert.equal((point.x - view.x) / view.scale, (point.x - zoomed.x) / zoomed.scale);
  assert.equal((point.y - view.y) / view.scale, (point.y - zoomed.y) / zoomed.scale);
  assert.equal(zoomAt(view, 1000, point).scale, MAX_SCALE);
  assert.equal(zoomAt(view, 0.0001, point).scale, MIN_SCALE);
  assert.deepEqual(panBy(view, 5, -5), { x: 15, y: 15, scale: 1 });
});

test("svgSize reads the root's size, or its viewBox", () => {
  assert.deepEqual(svgSize('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 1 1">'), {
    width: 640,
    height: 480,
  });
  assert.deepEqual(svgSize('<svg viewBox="0 0 320.5 200">'), { width: 320.5, height: 200 });
  assert.equal(svgSize("<div>"), null);
});

test("the share page reads its token from the path, and nothing else", () => {
  const token = `nds_${"a".repeat(43)}`;
  assert.equal(shareTokenFromPath(`/share/${token}`), token);
  assert.equal(shareTokenFromPath(`/share/${token}/`), token);
  assert.equal(shareTokenFromPath("/share/"), null);
  assert.equal(shareTokenFromPath("/share/a/b"), null);
  assert.equal(shareTokenFromPath("/project/abc"), null);
  assert.equal(shareUrl(token, "https://nebula.example"), `https://nebula.example/share/${token}`);
});
