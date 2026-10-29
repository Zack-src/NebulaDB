import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Admin → Rétention: each journal with its duration and where it comes from, an edit below the
 * audit log's confirmation threshold, the reset to the default, and the purge with its typed key.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each step.
 */

const PORT = Number(process.env.E2E_PORT) || 4421;

test("retention: edit with confirmation, reset, purge by typing the key", { timeout: 90_000 }, async () => {
  const env = await startE2eEnvironment(PORT);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    let shot = 0;
    const snap = async (name: string) => {
      if (process.env.E2E_SHOTS)
        await page.screenshot({ path: join(process.env.E2E_SHOTS, `retention-${++shot}-${name}.png`) });
    };
    await login(page, env.baseUrl);

    await page.getByRole("button", { name: "Admin", exact: true }).click();
    await page.getByRole("button", { name: "Rétention" }).click();
    const audit = page.locator('[data-testid="retention-row"][data-key="audit_log"]');
    await audit.waitFor();
    assert.ok((await page.getByTestId("retention-row").count()) > 3);
    await snap("list");
    await audit.getByText("Environnement").waitFor();

    // A short audit retention asks for a confirmation, and nothing is saved before it.
    const duration = audit.getByRole("spinbutton", { name: "Rétention de Journal d'audit" });
    assert.equal(await duration.inputValue(), "365");
    await duration.fill("30");
    await audit.getByRole("button", { name: "Enregistrer" }).click();
    const confirm = page.getByRole("dialog", { name: "Conserver ce journal peu de temps ?" });
    await confirm.waitFor();
    await snap("confirm-short");
    await confirm.getByRole("button", { name: "Annuler" }).click();
    await confirm.waitFor({ state: "detached" });
    await audit.getByText("Environnement").waitFor();

    await audit.getByRole("button", { name: "Enregistrer" }).click();
    await confirm.getByRole("button", { name: "Raccourcir la rétention" }).click();
    await confirm.waitFor({ state: "detached" });
    await audit.getByText("Réglé ici").waitFor();
    assert.equal(await duration.inputValue(), "30");

    // Out of the bounds: refused in the field, nothing sent.
    await duration.fill("3");
    await audit.getByText("Au moins 7.").waitFor();
    assert.equal(await audit.getByRole("button", { name: "Enregistrer" }).isDisabled(), true);

    await audit.getByRole("button", { name: "Valeur par défaut" }).click();
    await audit.getByText("Environnement").waitFor();
    assert.equal(await duration.inputValue(), "365");

    // The purge needs the journal's key, typed back.
    await audit.getByRole("button", { name: "Purger maintenant" }).click();
    const dialog = page.getByRole("dialog", { name: "Purger Journal d'audit" });
    await dialog
      .getByTestId("retention-preview")
      .getByText(/Rien à supprimer|seraient supprimées|serait supprimée/)
      .waitFor();
    const purge = dialog.getByRole("button", { name: "Purger maintenant" });
    assert.equal(await purge.isDisabled(), true);
    await dialog.getByRole("textbox").fill("audit_log");
    await snap("purge");
    await purge.click();
    await dialog.waitFor({ state: "detached" });
    await page
      .getByTestId("retention-result")
      .getByText(/Journal d'audit/)
      .waitFor();
    await audit.getByText("manuelle").waitFor();
    await snap("done");

    assert.deepEqual(errors, []);
  } finally {
    await env.teardown();
  }
});
