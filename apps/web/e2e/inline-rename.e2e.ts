import assert from "node:assert/strict";
import { test } from "node:test";
import type { Locator, Page } from "playwright-core";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Renaming a table or a column happens in place: opening the field changes neither the size of the
 * table nor the size of the text, and the whole name stays visible.
 */

const PORT = Number(process.env.E2E_PORT) || 4437;

async function openNewProject(page: Page): Promise<void> {
  const inputCountBefore = await page.locator("input").count();
  await page.getByRole("button", { name: "Nouveau projet" }).first().click();
  await page.locator("input").nth(inputCountBefore).waitFor({ timeout: 10_000 });
  await page.locator("input").last().press("Escape");
  const card = page.getByText("Nouveau schéma 1", { exact: true });
  await card.waitFor({ timeout: 10_000 });
  await card.click();
  await page.locator(".svelte-flow__pane").waitFor({ timeout: 10_000 });
}

const textStyle = (el: Locator) =>
  el.evaluate((node) => {
    const style = getComputedStyle(node);
    return { fontSize: style.fontSize, fontWeight: style.fontWeight };
  });

test(
  "renaming a table or a column in place keeps the table and the text the same size",
  { timeout: 60_000 },
  async () => {
    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage({ viewport: { width: 1400, height: 800 } });
      await login(page, env.baseUrl);
      await openNewProject(page);
      await page.locator(".svelte-flow__pane").click({ button: "right", position: { x: 300, y: 200 } });
      await page.getByText("Ajouter une table", { exact: true }).click();
      const node = page.locator(".svelte-flow__node").first();
      await node.waitFor({ timeout: 10_000 });

      const cases = [
        { what: "table", name: node.locator("span").first(), target: node.locator("span").first().locator("xpath=..") },
        {
          what: "column",
          name: node.locator(".table-row-name", { hasText: /^id$/ }),
          target: node.locator(".table-row-name", { hasText: /^id$/ }),
        },
      ];
      for (const { what, name, target } of cases) {
        const textBefore = await textStyle(name);
        const sizeBefore = await node.boundingBox();
        await target.dispatchEvent("dblclick");
        const input = node.locator("input");
        await input.waitFor({ timeout: 5_000 });
        assert.deepEqual(await textStyle(input), textBefore, `${what}: same text size while editing`);
        assert.deepEqual(await node.boundingBox(), sizeBefore, `${what}: the table keeps its size`);
        assert.ok(
          await input.evaluate((el: HTMLInputElement) => el.scrollWidth <= el.clientWidth + 1),
          `${what}: the whole name is visible`,
        );
        if (process.env.E2E_SHOTS)
          await page.screenshot({ path: `${process.env.E2E_SHOTS}/inline-rename-${what}.png` });
        await input.press("Escape");
        await input.waitFor({ state: "detached", timeout: 5_000 });
      }
    } finally {
      await env.teardown();
    }
  },
);
