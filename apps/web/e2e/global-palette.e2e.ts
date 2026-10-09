import { test } from "node:test";
import assert from "node:assert/strict";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Ctrl+K from the dashboard and from inside a project: a cross-project hit
 * opens its project centred on the table, the open project's own tables are
 * found without leaving it, a place is reachable by name, and Escape gives
 * focus back. The ranking and who-sees-what rules are unit-tested in
 * `features/palette/paletteModel.test.ts`.
 */

const PORT = Number(process.env.E2E_PORT) || 4398;

test(
  "Ctrl+K jumps to a table across projects, within the open project, and to an admin tab",
  { timeout: 90_000 },
  async () => {
    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage();
      page.setDefaultTimeout(15_000);
      await login(page, env.baseUrl);

      await page.evaluate(async () => {
        for (const [name, source] of [
          ["Boutique", "Table orders {\n id int [pk]\n customer_id int\n}\nTable carts {\n id int [pk]\n}"],
          ["Comptes", "Table users {\n id int [pk]\n}"],
        ]) {
          const res = await fetch("/api/projects", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name }),
          });
          if (!res.ok) throw new Error(`seed failed: ${res.status}`);
          const { id } = await res.json();
          await fetch(`/api/projects/${id}/import`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ source }),
          });
        }
      });
      await page.reload();
      await page.getByRole("button", { name: "Nouveau projet" }).first().waitFor();

      const palette = page.getByTestId("global-palette");
      const input = palette.getByRole("combobox");

      // Escape closes it and hands focus back to where it was.
      const search = page.getByPlaceholder("Rechercher un schéma…");
      await search.focus();
      await page.keyboard.press("Control+k");
      await input.waitFor();
      await page.keyboard.press("Escape");
      await palette.waitFor({ state: "detached" });
      assert.equal(await search.evaluate((el) => el === document.activeElement), true);

      // From the dashboard: a column in another project, found by the server.
      await page.keyboard.press("Control+k");
      await input.fill("customer_id");
      await palette.getByRole("option", { name: /orders\.customer_id/ }).click();
      await page.waitForURL(/\/project\//);
      await page.locator(".svelte-flow__node.selected").getByText("orders", { exact: true }).waitFor();

      // Inside the project: its own table, no server round trip needed, picked with the keyboard.
      await page.locator(".svelte-flow__pane").click({ position: { x: 5, y: 5 } });
      await page.keyboard.press("Control+k");
      await input.fill("carts");
      await palette.getByRole("option", { name: /carts/ }).first().waitFor();
      await page.keyboard.press("Enter");
      await page.locator(".svelte-flow__node.selected").getByText("carts", { exact: true }).waitFor();

      // A place by name; the admin tabs are offered to this instance administrator.
      await page.locator(".svelte-flow__pane").click({ position: { x: 5, y: 5 } });
      await page.keyboard.press("Control+k");
      await input.fill("Environnements");
      await page.keyboard.press("Enter");
      await page.locator('.admin-navigation button[aria-current="page"]', { hasText: "Environnements" }).waitFor();
    } finally {
      await env.teardown();
    }
  },
);
