import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { clickRevealedOnHover, login, startE2eEnvironment } from "./harness.js";

/**
 * A table's settings: duplicate and lock side by side, and a delete button at the top right of the panel.
 * Set `E2E_SHOTS=<dir>` to keep a screenshot.
 */

const PORT = Number(process.env.E2E_PORT) || 4447;

test("table settings: buttons side by side, delete at the top right", { timeout: 90_000 }, async () => {
  const env = await startE2eEnvironment(PORT);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(15_000);
    await login(page, env.baseUrl);
    const projectId = await page.evaluate(async () => {
      const json = { "content-type": "application/json" };
      const created = await fetch("/api/projects", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ name: "Boutique" }),
      });
      const { id } = (await created.json()) as { id: string };
      await fetch(`/api/projects/${id}/import`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ source: "Table customers {\n  id int [pk]\n}\nTable orders {\n  id int [pk]\n}\n" }),
      });
      return id;
    });

    await page.goto(`${env.baseUrl}/project/${projectId}`);
    const table = (name: string) => page.locator(".svelte-flow__node").filter({ hasText: name });
    await table("customers").waitFor();
    await clickRevealedOnHover(table("customers"), table("customers").getByRole("button", { name: "Paramètres de la table" }));

    const duplicate = page.getByRole("button", { name: "Dupliquer" });
    const lock = page.getByRole("button", { name: "Verrouiller la table" });
    const remove = page.getByRole("button", { name: "Supprimer", exact: true });
    await remove.waitFor();
    const [d, l, r, title] = await Promise.all([
      duplicate.boundingBox(),
      lock.boundingBox(),
      remove.boundingBox(),
      page.getByText("Paramètres de la table", { exact: true }).boundingBox(),
    ]);
    assert.ok(d && l && r && title);
    assert.ok(Math.abs(d.y - l.y) < 2, "duplicate and lock share a row");
    assert.ok(d.height >= 36 && l.height >= 36, "tall enough to click comfortably");
    assert.ok(r.x > title.x && Math.abs(r.y + r.height / 2 - (title.y + title.height / 2)) < 12, "delete is in the header, to the right");
    if (process.env.E2E_SHOTS) await page.screenshot({ path: join(process.env.E2E_SHOTS, "table-settings.png") });

    await remove.click();
    await table("customers").waitFor({ state: "detached" });
    await table("orders").waitFor();
  } finally {
    await env.teardown();
  }
});
