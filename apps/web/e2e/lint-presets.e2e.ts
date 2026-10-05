import { test } from "node:test";
import assert from "node:assert/strict";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * The library of lint presets: an administrator writes one with a custom
 * rule and makes it the default, a project follows it, then keeps a version
 * of its own (and can go back). Rule titles are French, as the UI is.
 */

const PORT = Number(process.env.E2E_PORT) || 4430;

const SOURCE = `Table orders {
  id integer [pk]
  note: 'Customer orders.'
}
`;

test(
  "lint presets: a default preset with a custom rule reaches a project, which can keep its own version",
  {
    timeout: 120_000,
  },
  async () => {
    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage({ viewport: { width: 1400, height: 1000 } });
      page.setDefaultTimeout(15_000);
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(String(err)));
      await login(page, env.baseUrl);

      const projectId = await page.evaluate(async (source) => {
        const json = { "content-type": "application/json" };
        const created = await fetch("/api/projects", {
          method: "POST",
          headers: json,
          body: JSON.stringify({ name: "Boutique" }),
        });
        const { id } = (await created.json()) as { id: string };
        await fetch(`/api/projects/${id}/import`, { method: "POST", headers: json, body: JSON.stringify({ source }) });
        return id;
      }, SOURCE);

      // Admin → Lint: a preset with one custom rule, made the default.
      await page.getByRole("button", { name: "Admin", exact: true }).click();
      await page.getByRole("button", { name: "Lint", exact: true }).click();
      const library = page.getByTestId("lint-presets");
      await library.getByText("Aucun modèle.").waitFor();
      await library.getByRole("button", { name: "Nouveau modèle" }).click();

      const form = page.getByTestId("lint-preset-form");
      await form.getByLabel("Nom", { exact: true }).fill("Entreprise");
      await form.getByRole("button", { name: "Ajouter une règle" }).click();
      await form.getByLabel("Titre de la règle").fill("Tables préfixées app_");
      await form.getByLabel("Motif (expression régulière)").fill("^app_");
      await form.getByRole("combobox", { name: "Niveau" }).click();
      await page.getByRole("option", { name: "Erreur" }).click();
      // A pattern that is not a regular expression is refused before anything is sent.
      await form.getByLabel("Motif (expression régulière)").fill("(");
      await form.getByText(/n'est pas une expression régulière valide/).waitFor();
      assert.equal(await form.getByRole("button", { name: "Enregistrer les règles" }).isDisabled(), true);
      await form.getByLabel("Motif (expression régulière)").fill("^app_");
      await form.getByRole("button", { name: "Enregistrer les règles" }).click();
      await form.getByRole("button", { name: "Enregistrer les règles" }).waitFor({ state: "detached" });
      await form.getByRole("button", { name: "Enregistrer", exact: true }).click();

      const row = library.locator('[data-preset="Entreprise"]');
      await row.waitFor();
      const listRow = library
        .locator("div.rounded-sm.border")
        .filter({ has: page.locator(`[data-preset="Entreprise"]`) });
      await listRow.getByRole("button", { name: "Définir par défaut" }).click();
      await row.getByText("Par défaut", { exact: true }).waitFor();

      // The project follows it: the source says so and the custom rule runs.
      await page.goto(`${env.baseUrl}/project/${projectId}/problems`);
      const source = page.getByTestId("lint-source");
      await source.waitFor();
      assert.equal(await source.getAttribute("data-source"), "default");
      assert.match((await page.getByTestId("lint-source-text").textContent()) ?? "", /Entreprise/);
      const panel = page.getByTestId("problems");
      const custom = panel.locator('[data-table="orders"] [data-rule^="custom:"]');
      await custom.waitFor();
      assert.equal(await custom.getAttribute("data-severity"), "error");

      // Its own version: an exception takes the finding away for this project only.
      await source.getByRole("combobox", { name: "Origine des règles du projet" }).click();
      await page.getByRole("option", { name: "Version propre à ce projet" }).click();
      await page.waitForFunction(
        () => document.querySelector('[data-testid="lint-source"]')?.getAttribute("data-source") === "own",
      );
      await custom.getByRole("button", { name: "Ignorer pour cette table" }).click();
      await custom.waitFor({ state: "detached" });
      const own = await page.evaluate(async (id) => {
        const res = await fetch(`/api/projects/${id}/lint`);
        return (await res.json()) as { source: { kind: string }; settings: { customRules: { id: string }[] } };
      }, projectId);
      assert.equal(own.source.kind, "own");
      assert.equal(own.settings.customRules.length, 1, "the copy keeps the preset's rule");

      // Back to the default: its rule is back, the exception is gone.
      await source.getByRole("combobox", { name: "Origine des règles du projet" }).click();
      await page.getByRole("option", { name: "Modèle par défaut de l'instance" }).click();
      await custom.waitFor();
      assert.equal(await source.getAttribute("data-source"), "default");

      // What the server lints is what the editor shows.
      const report = await page.evaluate(async (id) => {
        const res = await fetch(`/api/v1/projects/${id}/lint`);
        return (await res.json()) as { source: { kind: string }; findings: { ruleId: string }[] };
      }, projectId);
      assert.equal(report.source.kind, "default");
      assert.ok(report.findings.some((finding) => finding.ruleId.startsWith("custom:")));
      assert.deepEqual(errors, []);
    } finally {
      await env.teardown();
    }
  },
);
