import { test } from "node:test";
import assert from "node:assert/strict";
import { login, startE2eEnvironment } from "./harness.js";

/** The header reserves the room of its hover-only buttons: a table is the same size before and after the pointer reaches it. */

const PORT = Number(process.env.E2E_PORT) || 4449;

test("table header: same size at rest and on hover", { timeout: 90_000 }, async () => {
  const env = await startE2eEnvironment(PORT);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(15_000);
    await login(page, env.baseUrl);
    const projectId = await page.evaluate(async () => {
      const json = { "content-type": "application/json" };
      const created = await fetch("/api/projects", { method: "POST", headers: json, body: JSON.stringify({ name: "Boutique" }) });
      const { id } = (await created.json()) as { id: string };
      await fetch(`/api/projects/${id}/import`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ source: "Table customer_order_items_archive {\n  id int [pk]\n}\nTable other {\n  id int [pk]\n}\n" }),
      });
      return id;
    });
    await page.goto(`${env.baseUrl}/project/${projectId}`);
    const table = page.locator(".svelte-flow__node").filter({ hasText: "customer_order_items_archive" }).first();
    await table.waitFor();
    await page.waitForTimeout(800);
    const rest = await table.boundingBox();
    await table.hover();
    await page.waitForTimeout(300);
    const hovered = await table.boundingBox();
    assert.ok(rest && hovered);
    assert.ok(Math.abs(rest.width - hovered.width) < 1.5, `width ${rest.width} at rest, ${hovered.width} on hover`);
    assert.ok(Math.abs(rest.height - hovered.height) < 1.5, `height ${rest.height} at rest, ${hovered.height} on hover`);
  } finally {
    await env.teardown();
  }
});
