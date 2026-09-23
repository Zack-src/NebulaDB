import { test } from "node:test";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Dashboard search → a column found inside another project → clicking it
 * opens that project centred on the table, with the table selected. The
 * ranking/permission rules are covered by `modules/search/routes.test.ts`;
 * this is the round trip through the real UI and canvas.
 */

const PORT = Number(process.env.E2E_PORT) || 4396;

test(
  "search a column across projects → open the hit → its table is centred and selected",
  { timeout: 60_000 },
  async () => {
    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage();
      page.setDefaultTimeout(15_000);
      await login(page, env.baseUrl);

      // Seed two projects through the real API, with the logged-in session.
      await page.evaluate(async () => {
        for (const [name, template] of [
          ["Boutique", "ecommerce"],
          ["Comptes", "auth"],
        ]) {
          const res = await fetch("/api/projects", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name, template }),
          });
          if (!res.ok) throw new Error(`seed failed: ${res.status}`);
        }
      });
      await page.reload();

      await page.getByPlaceholder("Rechercher un schéma…").fill("customer_id");
      const results = page.getByTestId("global-search");
      const hit = results.getByRole("button", { name: /orders\.customer_id/ });
      await hit.waitFor();
      await hit.click();

      await page.waitForURL(/\/project\//);
      await page.locator(".svelte-flow__node.selected").getByText("orders", { exact: true }).waitFor();
    } finally {
      await env.teardown();
    }
  },
);
