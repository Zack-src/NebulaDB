import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * A selected line is visibly selected, also on the line that holds the cursor: the active-line
 * background must not paint over the selection drawn behind it.
 * Set `E2E_SHOTS=<dir>` to keep a screenshot.
 */

const PORT = Number(process.env.E2E_PORT) || 4451;

test("DBML editor: the selection shows on the cursor's line", { timeout: 90_000 }, async () => {
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
        body: JSON.stringify({ source: "Table customers {\n  id int [pk]\n  name varchar\n}\n" }),
      });
      return id;
    });
    await page.goto(`${env.baseUrl}/project/${projectId}`);
    const line = page.locator(".cm-content .cm-line").filter({ hasText: "name varchar" });
    await line.waitFor();
    await line.click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");

    await page.locator(".cm-selectionBackground").first().waitFor();
    // Nothing opaque over the selection on the cursor's line.
    const activeBackground = await page
      .locator(".cm-activeLine")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.match(activeBackground, /rgba\(0, 0, 0, 0\)|transparent/);
    if (process.env.E2E_SHOTS) await page.screenshot({ path: join(process.env.E2E_SHOTS, "dbml-selection.png") });

    // Without a selection the active line is highlighted again.
    await page.keyboard.press("ArrowRight");
    const restored = await page.locator(".cm-activeLine").evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.doesNotMatch(restored, /rgba\(0, 0, 0, 0\)|transparent/);
  } finally {
    await env.teardown();
  }
});
