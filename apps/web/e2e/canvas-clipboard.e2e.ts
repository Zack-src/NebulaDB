import assert from "node:assert/strict";
import { test } from "node:test";
import type { Page } from "playwright-core";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Copy / paste of tables on the canvas (docs/todo.md, Phase 29). The naming,
 * id remapping and clipboard parsing are unit-tested in
 * `tableClipboard.test.ts`; what only a browser can show is that Ctrl+C /
 * Ctrl+V actually reach the canvas through the `copy` / `paste` events, that
 * the result is written to the document, and that the same clipboard pastes
 * as text into the DBML editor.
 */

const PORT = Number(process.env.E2E_PORT) || 4401;

const SCHEMA = `Table users {
  id int [pk]
}

Table orders {
  id int [pk]
  user_id int
}

Ref: orders.user_id > users.id`;

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

/** A viewport point where the bare canvas is on top — tables and toolbars move with every paste. */
async function emptyCanvasPoint(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(() => {
    const pane = document.querySelector(".svelte-flow__pane")!.getBoundingClientRect();
    for (let y = pane.top + 30; y < pane.bottom - 30; y += 25) {
      for (let x = pane.left + 30; x < pane.right - 30; x += 25) {
        if (document.elementFromPoint(x, y)?.classList.contains("svelte-flow__pane")) return { x, y };
      }
    }
    return null;
  });
  assert.ok(point, "some empty canvas is visible");
  return point;
}

const tableNode = (page: Page, name: string) =>
  page.locator(".svelte-flow__node").filter({ has: page.getByText(name, { exact: true }) });
const tableHeader = (page: Page, name: string) => tableNode(page, name).getByText(name, { exact: true });

test(
  "canvas: Ctrl+C / Ctrl+V copies tables with their relation, and the clipboard is DBML",
  { timeout: 90_000 },
  async () => {
    const env = await startE2eEnvironment(PORT);
    try {
      const context = await env.browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
      const page = await context.newPage();
      await login(page, env.baseUrl);
      await openNewProject(page);

      await page.locator(".cm-content").click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.insertText(SCHEMA);
      await tableNode(page, "orders").waitFor({ timeout: 10_000 });
      await page.locator(".svelte-flow__edge").first().waitFor({ state: "attached", timeout: 10_000 });
      await page.locator('[data-sync-state="synced"]').waitFor({ timeout: 10_000 });

      // Select both tables, copy, paste.
      await tableHeader(page, "users").click();
      await tableHeader(page, "orders").click({ modifiers: ["ControlOrMeta"] });
      await page.keyboard.press("ControlOrMeta+c");
      await page.getByText("2 tables copiées").waitFor({ timeout: 5000 });
      await page.keyboard.press("ControlOrMeta+v");
      await tableNode(page, "users_copy").waitFor({ timeout: 10_000 });
      await tableNode(page, "orders_copy").waitFor({ timeout: 10_000 });
      assert.equal(
        await page.locator(".svelte-flow__edge").count(),
        2,
        "the relation between the two copies came along",
      );

      // A second paste of the same clipboard: next free names, not duplicates.
      await page.keyboard.press("ControlOrMeta+v");
      await tableNode(page, "users_copy2").waitFor({ timeout: 10_000 });
      assert.equal(await page.locator(".svelte-flow__node").count(), 6);

      // Right-click ▸ Paste puts a third set where the menu was opened.
      const empty = await emptyCanvasPoint(page);
      await page.mouse.click(empty.x, empty.y, { button: "right" });
      await page.getByRole("menu").getByRole("button", { name: /^Coller/ }).click();
      await tableNode(page, "users_copy3").waitFor({ timeout: 10_000 });

      // The clipboard itself is plain DBML (plus one comment line) — what a text field receives.
      const clipboard = await page.evaluate(() => navigator.clipboard.readText());
      assert.match(clipboard, /^Table users \{/);
      assert.match(clipboard, /Ref: orders\.user_id > users\.id/);

      // Persisted: the copies are in the document, not just on this canvas.
      await page.reload();
      await tableNode(page, "orders_copy3").waitFor({ timeout: 10_000 });
      assert.equal(await page.locator(".svelte-flow__edge").count(), 4);

      // Ctrl+Z takes a paste back in one step.
      await tableHeader(page, "users").click();
      await page.keyboard.press("ControlOrMeta+c");
      await page.keyboard.press("ControlOrMeta+v");
      await tableNode(page, "users_copy4").waitFor({ timeout: 10_000 });
      await page.keyboard.press("ControlOrMeta+z");
      await tableNode(page, "users_copy4").waitFor({ state: "detached", timeout: 10_000 });
    } finally {
      await env.teardown();
    }
  },
);
