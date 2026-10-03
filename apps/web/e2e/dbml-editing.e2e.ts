import assert from "node:assert/strict";
import { test } from "node:test";
import type { Page } from "playwright-core";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * The reported Phase 29 bug, in a real browser: retargeting a `Ref:` by hand
 * "rolled the text back". `bufferSync.test.ts` covers the arbitration rules
 * against the real import pipeline; this is the wiring those rules sit behind
 * — CodeMirror, the panel's debounce, `/import`, and the realtime update
 * coming back — which no pure test reaches.
 */

const PORT = Number(process.env.E2E_PORT) || 4399;
/** Second environment: `node --test` may run the two scenarios' servers side by side. */
const SETTINGS_PORT = PORT + 10;
const SCREENSHOT = process.env.E2E_SCREENSHOT_DIR;

const SCHEMA = `// keep me: a hand-written comment
Table users {
  id int [pk]
}

Table customers {
  id int [pk]
}

Table orders {
  id int [pk]
  user_id   int   // deliberately misaligned
}

Ref: users.id < orders.user_id`;

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

/** The buffer as the user reads it. The schema is short enough that CodeMirror renders every line. */
async function bufferText(page: Page): Promise<string> {
  const lines = await page.locator(".cm-content .cm-line").allInnerTexts();
  return lines.map((line) => line.replace(/\n$/, "")).join("\n");
}

const refLines = (text: string) => text.split("\n").filter((line) => line.startsWith("Ref"));

test(
  "DBML panel: a hand-retargeted Ref stays as typed, comments and layout included",
  { timeout: 90_000 },
  async () => {
    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage();
      await login(page, env.baseUrl);
      await openNewProject(page);

      const editor = page.locator(".cm-content");
      await editor.click();
      await page.keyboard.press("ControlOrMeta+a");
      // Inserted in one go (a paste): typing it key by key would have
      // bracket-closing and completion rewrite the fixture.
      await page.keyboard.insertText(SCHEMA);
      const edge = page.locator(".svelte-flow__edge");
      await page.locator(".svelte-flow__node").filter({ hasText: "orders" }).waitFor({ timeout: 10_000 });
      await edge.first().waitFor({ state: "attached", timeout: 10_000 });

      // Long enough for the import to be acknowledged and the document to come
      // back: a reversed `<` relation used to be "corrected" here, replacing the
      // whole buffer with the serializer's layout.
      await page.waitForTimeout(3000);
      assert.equal(await bufferText(page), SCHEMA, "the buffer is left exactly as written");

      // Retarget the relation by hand, pausing on a half-typed table name long
      // enough for that invalid buffer to be posted (and rejected).
      await page.keyboard.press("ControlOrMeta+End");
      for (let i = 0; i < "users.id < orders.user_id".length; i++) await page.keyboard.press("Backspace");
      await page.keyboard.type("cust", { delay: 40 });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1500);
      await page.keyboard.type("omers.id < orders.user_id", { delay: 40 });
      await page.keyboard.press("Escape");

      const expected = SCHEMA.replace("users.id < orders", "customers.id < orders");
      for (const wait of [300, 1200, 3000]) {
        await page.waitForTimeout(wait);
        assert.equal(await bufferText(page), expected, `buffer after a further ${wait} ms`);
      }
      assert.equal(await edge.count(), 1, "one relation on the canvas, not the old one next to the new one");

      // And it is what was saved: a fresh load serialises the document itself.
      await page.reload();
      await page.locator(".cm-content .cm-line").first().waitFor({ timeout: 10_000 });
      await page.locator(".svelte-flow__node").filter({ hasText: "orders" }).waitFor({ timeout: 10_000 });
      assert.deepEqual(refLines(await bufferText(page)), ["Ref: orders.user_id > customers.id"]);
    } finally {
      await env.teardown();
    }
  },
);

test(
  "DBML panel: the status bar says where the buffer stands, and sync can be made manual",
  { timeout: 90_000 },
  async () => {
    const env = await startE2eEnvironment(SETTINGS_PORT);
    try {
      const page = await env.browser.newPage();
      await login(page, env.baseUrl);
      await openNewProject(page);

      const syncState = (state: string) => page.locator(`[data-sync-state="${state}"]`);
      await syncState("synced").waitFor({ timeout: 10_000 });

      const editor = page.locator(".cm-content");
      await editor.click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.insertText("Table users {\n  id   int [pk]\n}");
      await syncState("pending").waitFor({ timeout: 2000 });
      await syncState("synced").waitFor({ timeout: 10_000 });
      await page.locator(".svelte-flow__node").filter({ hasText: "users" }).waitFor({ timeout: 10_000 });

      // An invalid buffer is an error with its line, not a silent "pending".
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.insertText("\nRef: users.id > nowhere.id");
      await syncState("error").waitFor({ timeout: 10_000 });
      assert.match(await syncState("error").innerText(), /ligne 4/);

      // Settings: nothing reformats by default, and sync can wait for Ctrl+S.
      await page.getByRole("button", { name: "Comportement de l'éditeur" }).click();
      const group = (label: string) => page.getByRole("radiogroup", { name: label });
      assert.equal(
        await group("Formater automatiquement").getByRole("radio", { name: "Jamais" }).getAttribute("aria-checked"),
        "true",
      );
      if (SCREENSHOT) await page.screenshot({ path: `${SCREENSHOT}/dbml-settings.png` });
      await group("Synchroniser avec le diagramme").getByRole("radio", { name: "Ctrl+S" }).click();
      await group("Formater automatiquement").getByRole("radio", { name: "À l'enregistrement" }).click();
      await page.keyboard.press("Escape");

      await editor.click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.insertText("Table accounts {\n  id   int [pk]\n}");
      await page.waitForTimeout(2500);
      assert.equal(await syncState("pending").count(), 1, "manual sync: nothing is sent until asked");
      assert.equal(await page.locator(".svelte-flow__node").filter({ hasText: "accounts" }).count(), 0);

      await page.keyboard.press("ControlOrMeta+s");
      await syncState("synced").waitFor({ timeout: 10_000 });
      await page.locator(".svelte-flow__node").filter({ hasText: "accounts" }).waitFor({ timeout: 10_000 });
      assert.equal(await bufferText(page), "Table accounts {\n  id int [pk]\n}\n", "formatted on save, as asked");
    } finally {
      await env.teardown();
    }
  },
);
