import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const blocks = [...css.matchAll(/^:root(?:\[data-theme="light"\])? \{([\s\S]*?)\n\}/gm)];

function luminance(hex: string): number {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function contrast(a: string, b: string): number {
  const [lo, hi] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (hi + 0.05) / (lo + 0.05);
}

for (const [index, block] of blocks.entries()) {
  const theme = index ? "light" : "dark";
  const values = Object.fromEntries(
    [...block[1].matchAll(/--color-([\w-]+):\s*(#[\da-f]{6});/gi)].map((m) => [m[1], m[2]]),
  );
  test(`${theme} theme: body, secondary and muted text satisfy AA on workspace surfaces`, () => {
    for (const foreground of ["text", "text-secondary", "text-muted"]) {
      for (const surface of ["bg", "surface", "surface-raised", "bg-canvas"]) {
        assert.ok(contrast(values[foreground], values[surface]) >= 4.5, `${foreground} on ${surface}`);
      }
    }
  });
  test(`${theme} theme: status labels and primary actions remain legible`, () => {
    assert.ok(contrast(values["text-on-accent"], values.primary) >= 4.5);
    for (const color of ["primary", "success", "warning", "danger", "info"]) {
      assert.ok(contrast(values[`${color}-text`], values[`${color}-light`]) >= 4.5, color);
    }
    assert.ok(contrast(values["border-control"], values["surface-raised"]) >= 3);
  });
}
