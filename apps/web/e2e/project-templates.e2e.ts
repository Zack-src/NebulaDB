import { test } from "node:test";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Template gallery → seeded project, in a real browser against the real
 * build. The REST side (`POST /api/projects` with `template`) is covered by
 * `apps/server/src/modules/projects/routes.test.ts`; what this adds is the
 * gallery actually rendering, the pick reaching the server, and the seeded
 * tables arriving on the canvas over the live Yjs sync path. Same
 * prerequisites as `project-lifecycle.e2e.ts`.
 */

const PORT = Number(process.env.E2E_PORT) || 4394;

test(
  "pick the e-commerce template → the new project opens with its tables on the canvas",
  { timeout: 60_000 },
  async () => {
    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage();
      await login(page, env.baseUrl);

      const inputCountBefore = await page.locator("input").count();
      await page.getByRole("button", { name: "Depuis un modèle" }).first().click();
      await page.locator('[data-template="ecommerce"]').click();

      // Same instant-create-then-rename flow as a blank project: the gallery
      // closes and the new tile opens in rename mode, named after the
      // template. Wait for both — the gallery tiles carry the name
      // "E-commerce" too, and the rename field only exists once the create
      // resolves. Escape then keeps the template's name.
      await page.locator('[data-template="ecommerce"]').waitFor({ state: "detached", timeout: 10_000 });
      await page.locator("input").nth(inputCountBefore).waitFor({ timeout: 10_000 });
      await page.locator("input").last().press("Escape");
      const card = page.getByText("E-commerce", { exact: true });
      await card.waitFor({ timeout: 10_000 });
      await card.click();

      for (const table of ["customers", "orders", "order_items", "products"]) {
        await page.locator(".svelte-flow__node").getByText(table, { exact: true }).waitFor({ timeout: 10_000 });
      }
    } finally {
      await env.teardown();
    }
  },
);
