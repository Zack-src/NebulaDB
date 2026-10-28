import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { startE2eEnvironment } from "./harness.js";

/**
 * First-run setup on a server started with no account (no `bootstrap-admin`): the setup screen instead of the
 * login form, the checks before sending, the first administrator signed in straight away, then the screen gone
 * for good. A second server with NEBULADB_SETUP_TOKEN asks for the token. The API edge cases (concurrency,
 * weak passwords, API keys) live in `apps/server/src/modules/setup/`.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each step.
 */

const PORT = Number(process.env.E2E_PORT) || 4531;
const TOKEN_PORT = PORT + 1;
const PASSWORD = "a long first admin passphrase";

test(
  "first-run setup without a token: warn, create the admin, then only the login form",
  { timeout: 90_000 },
  async () => {
    const env = await startE2eEnvironment(PORT, {}, { seedAdmin: false });
    try {
      const page = await env.browser.newPage({ viewport: { width: 1280, height: 900 } });
      page.setDefaultTimeout(15_000);
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(String(err)));
      await page.addInitScript(() => localStorage.setItem("nebuladb.tour.workspace.seen", "true"));
      const snap = async (name: string) => {
        if (process.env.E2E_SHOTS) await page.screenshot({ path: join(process.env.E2E_SHOTS, `setup-${name}.png`) });
      };

      await page.goto(env.baseUrl);
      await page.getByRole("heading", { name: "Configurer NebulaDB" }).waitFor();
      await page.getByText("La première personne qui atteint cette page").waitFor();
      assert.equal(await page.getByLabel("Jeton d'installation").count(), 0);
      assert.equal(await page.getByRole("button", { name: "Se connecter" }).count(), 0);
      await snap("empty");

      const form = page.getByRole("form", { name: "Créer le premier administrateur" });
      await form.getByLabel("Adresse e-mail").fill("first-admin@example.com");
      await form.getByLabel("Nom affiché").fill("Première Admin");
      await form.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);
      await form.getByLabel("Confirmer le mot de passe").fill(`${PASSWORD}!`);
      await form.getByRole("button", { name: "Créer l'administrateur" }).click();
      await page.getByText("Les mots de passe ne correspondent pas.").waitFor();
      await snap("mismatch");

      await form.getByLabel("Confirmer le mot de passe").fill(PASSWORD);
      await form.getByRole("button", { name: "Créer l'administrateur" }).click();
      // Signed in straight away, as an administrator.
      await page.getByRole("button", { name: "Nouveau projet" }).first().waitFor();
      await page.getByRole("button", { name: "Admin", exact: true }).waitFor();
      await snap("signed-in");

      // From now on the setup is closed: the API refuses it and a new visitor gets the login form.
      const status = (await (await fetch(`${env.baseUrl}/api/setup/status`)).json()) as { needsSetup: boolean };
      assert.equal(status.needsSetup, false);
      const again = await fetch(`${env.baseUrl}/api/setup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "late@example.com", password: PASSWORD, displayName: "Late" }),
      });
      assert.equal(again.status, 409);

      const stranger = await env.browser.newPage();
      stranger.setDefaultTimeout(15_000);
      await stranger.goto(env.baseUrl);
      await stranger.getByRole("button", { name: "Se connecter" }).waitFor();
      assert.equal(await stranger.getByRole("heading", { name: "Configurer NebulaDB" }).count(), 0);
      await stranger.getByLabel("Adresse e-mail").fill("first-admin@example.com");
      await stranger.getByLabel("Mot de passe").fill(PASSWORD);
      await stranger.getByRole("button", { name: "Se connecter" }).click();
      await stranger.getByRole("button", { name: "Nouveau projet" }).first().waitFor();

      assert.deepEqual(errors, []);
    } finally {
      await env.teardown();
    }
  },
);

test("first-run setup with NEBULADB_SETUP_TOKEN: the token is asked for and checked", { timeout: 90_000 }, async () => {
  const env = await startE2eEnvironment(TOKEN_PORT, { NEBULADB_SETUP_TOKEN: "e2e-setup-token" }, { seedAdmin: false });
  try {
    const page = await env.browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(15_000);
    await page.addInitScript(() => localStorage.setItem("nebuladb.tour.workspace.seen", "true"));
    await page.goto(env.baseUrl);
    const form = page.getByRole("form", { name: "Créer le premier administrateur" });
    await form.waitFor();
    assert.equal(await page.getByText("La première personne qui atteint cette page").count(), 0);

    await form.getByRole("button", { name: "Créer l'administrateur" }).click();
    // Checked first, and named on its field.
    await form.getByText("Ce champ est obligatoire.").waitFor();

    await form.getByLabel("Jeton d'installation").fill("wrong-token");
    await form.getByLabel("Adresse e-mail").fill("token-admin@example.com");
    await form.getByLabel("Nom affiché").fill("Token Admin");
    await form.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);
    await form.getByLabel("Confirmer le mot de passe").fill(PASSWORD);
    await form.getByRole("button", { name: "Créer l'administrateur" }).click();
    await page.getByText("Le jeton d'installation est absent ou incorrect.").waitFor();

    await form.getByLabel("Jeton d'installation").fill("e2e-setup-token");
    await form.getByRole("button", { name: "Créer l'administrateur" }).click();
    await page.getByRole("button", { name: "Nouveau projet" }).first().waitFor();
  } finally {
    await env.teardown();
  }
});
