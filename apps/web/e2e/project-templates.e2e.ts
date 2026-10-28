import assert from "node:assert/strict";
import { test } from "node:test";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Starting points: the first-project prompt and template gallery on the
 * project list, and the empty canvas of a project that has nothing yet.
 */

const PORT = Number(process.env.E2E_PORT) || 4394;

test("templates: first-project prompt, gallery, and the empty canvas", { timeout: 120_000 }, async () => {
  const env = await startE2eEnvironment(PORT);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    await login(page, env.baseUrl);

    // No project yet: a prompt with the three ways in, not a bare empty list.
    const prompt = page.getByTestId("first-project");
    await prompt.getByRole("heading", { name: "Créez votre premier projet" }).waitFor();
    await prompt.getByRole("button", { name: "Nouveau projet", exact: true }).waitFor();
    await prompt.getByRole("button", { name: "Nouveau projet depuis une base" }).waitFor();

    // Pick the e-commerce template: the new tile opens in rename mode, then the project opens with its tables.
    await prompt.getByRole("button", { name: "Depuis un modèle" }).click();
    await page.locator('[data-template="ecommerce"]').click();
    await page.locator('[data-template="ecommerce"]').waitFor({ state: "detached" });
    await page.getByTestId("project-tile").getByRole("textbox").press("Escape");
    await prompt.waitFor({ state: "detached" });
    await page.getByTestId("project-tile").getByText("E-commerce", { exact: true }).click();
    for (const table of ["customers", "orders", "order_items", "products"])
      await page.locator(".svelte-flow__node").getByText(table, { exact: true }).waitFor();
    assert.equal(await page.getByTestId("empty-canvas").count(), 0);

    // An empty project shows the guide; a template fills it in place.
    const emptyId = await page.evaluate(async () => {
      const created = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Vide" }),
      });
      return ((await created.json()) as { id: string }).id;
    });
    await page.waitForLoadState("networkidle");
    await page.goto(`${env.baseUrl}/project/${emptyId}`);
    const guide = page.getByTestId("empty-canvas");
    await guide.getByRole("heading", { name: "Ce schéma est vide" }).waitFor();
    await guide.getByRole("button", { name: "Importer du DBML ou du SQL" }).waitFor();
    await guide.getByRole("button", { name: "Depuis un modèle" }).click();
    await page.locator('[data-template="blog"]').click();
    for (const table of ["users", "posts", "comments", "tags"])
      await page.locator(".svelte-flow__node").getByText(table, { exact: true }).waitFor();
    await guide.waitFor({ state: "detached" });

    // Creating a table from the guide makes it disappear too.
    const secondId = await page.evaluate(async () => {
      const created = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Vide 2" }),
      });
      return ((await created.json()) as { id: string }).id;
    });
    await page.waitForLoadState("networkidle");
    await page.goto(`${env.baseUrl}/project/${secondId}`);
    await guide.getByRole("button", { name: "Créer une table" }).click();
    await page.locator(".svelte-flow__node").filter({ hasText: "table_1" }).waitFor();
    await guide.waitFor({ state: "detached" });
    assert.deepEqual(errors, []);
  } finally {
    await env.teardown();
  }
});
