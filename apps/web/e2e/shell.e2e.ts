import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { login, startE2eEnvironment } from "./harness.js";

test("workspace shell: global navigation, reload, history and mobile layout", { timeout: 90_000 }, async () => {
  const env = await startE2eEnvironment(4481);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(10_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await login(page, env.baseUrl);
    for (const name of ["Boutique en ligne", "Catalogue produits", "Comptabilité"])
      assert.ok((await page.request.post(`${env.baseUrl}/api/projects`, { data: { name } })).ok());
    await page.reload();
    const navigation = page.getByRole("navigation", { name: "Navigation principale", exact: true });
    await navigation.getByRole("button", { name: "Projets", exact: true }).waitFor();
    assert.equal(await navigation.getByRole("button", { name: "Accueil", exact: true }).count(), 0);
    await navigation.getByRole("button", { name: "Bases", exact: true }).click();
    await page.getByRole("heading", { name: "Bases", exact: true }).waitFor();
    assert.ok(page.url().endsWith("/#bases"));
    await navigation.getByRole("button", { name: "Admin", exact: true }).click();
    await page.getByRole("navigation", { name: "Console d'administration", exact: true }).waitFor();
    await page.goBack();
    await page.getByRole("heading", { name: "Bases", exact: true }).waitFor();

    await page.getByRole("button", { name: "Paramètres du compte", exact: true }).click();
    await page.getByRole("button", { name: "Profil et compte", exact: true }).waitFor();
    assert.ok(page.url().endsWith("/#settings"));
    // A keyboard skip link must not replace the current global destination.
    const skip = page.getByRole("link", { name: "Aller au contenu" });
    await skip.focus();
    await skip.press("Enter");
    assert.ok(page.url().endsWith("/#settings"));

    await navigation.getByRole("button", { name: "Projets", exact: true }).click();
    await page.getByRole("button", { name: "Nouveau projet", exact: true }).waitFor();
    if (process.env.E2E_SHOTS) await page.screenshot({ path: join(process.env.E2E_SHOTS, "new-ui-projects-dark.png") });
    await page.getByRole("button", { name: "Paramètres du compte", exact: true }).click();
    await page.getByRole("button", { name: "Apparence et thèmes", exact: true }).click();
    await page.getByRole("button", { name: "Clair moderne", exact: true }).click();
    await navigation.getByRole("button", { name: "Projets", exact: true }).click();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
    if (process.env.E2E_SHOTS)
      await page.screenshot({ path: join(process.env.E2E_SHOTS, "new-ui-projects-light.png") });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole("button", { name: "Nouveau projet", exact: true }).waitFor();
    const width = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    assert.ok(width.scroll <= width.client, "the mobile shell must not overflow the document horizontally");
    if (process.env.E2E_SHOTS)
      await page.screenshot({ path: join(process.env.E2E_SHOTS, "new-ui-projects-mobile.png") });
    assert.deepEqual(errors, []);
  } finally {
    await env.teardown();
  }
});
