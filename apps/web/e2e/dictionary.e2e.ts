import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * The data dictionary: descriptions, owner, classification and tags typed on
 * the dictionary tab end up in the schema's notes — so in the DBML, across a
 * reload, and in the exported document.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each step.
 */

const PORT = Number(process.env.E2E_PORT) || 4419;

const SOURCE = `Table customers {
  id integer [pk]
  email varchar(320) [not null]
}

Table orders {
  id integer [pk]
  customer_id integer [ref: > customers.id]
}

Enum order_status {
  paid [note: 'Commande réglée']
  sent
}
`;

test(
  "dictionary: what is typed is kept in the schema's notes, counted, filtered and exported",
  { timeout: 90_000 },
  async () => {
    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
      page.setDefaultTimeout(15_000);
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(String(err)));
      let shot = 0;
      const snap = async (name: string) => {
        if (process.env.E2E_SHOTS)
          await page.screenshot({ path: join(process.env.E2E_SHOTS, `dictionary-${++shot}-${name}.png`) });
      };
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

      await page.goto(`${env.baseUrl}/project/${projectId}/dictionary`);
      const panel = page.getByTestId("dictionary");
      const completeness = page.getByTestId("dictionary-completeness");
      await completeness.getByText("0 % décrit — tables 0/2, colonnes 0/4").waitFor();

      // A field is saved when it is left (or Enter is pressed).
      const customers = panel.locator('[data-table="customers"]');
      const fill = async (label: string, value: string) => {
        const input = customers.getByLabel(label, { exact: true });
        await input.fill(value);
        await input.press("Enter");
      };
      await fill("Description de customers", "Les clients de la boutique.");
      await fill("Responsable de customers", "equipe-crm");
      await fill("Étiquettes de customers", "rgpd, coeur");
      await customers.getByRole("combobox", { name: "Classification de customers", exact: true }).click();
      await page.getByRole("option", { name: "Personnel" }).click();
      await fill("Description de customers.email", "Adresse de connexion.");
      await customers.getByRole("combobox", { name: "Classification de customers.email" }).click();
      await page.getByRole("option", { name: "Sensible" }).click();
      await completeness.getByText("33 % décrit — tables 1/2, colonnes 1/4").waitFor();
      await snap("filled");

      // It is the schema: the DBML says it, and a reload brings it back.
      const dbml = await page.evaluate(
        async (id) => (await fetch(`/api/projects/${id}/export/dbml`)).text(),
        projectId,
      );
      assert.ok(
        dbml.includes("Note: 'Les clients de la boutique. [owner: equipe-crm] [class: personal] [tags: rgpd, coeur]'"),
        dbml,
      );
      assert.ok(dbml.includes("note: 'Adresse de connexion. [class: sensitive]'"), dbml);
      await page.reload();
      await completeness.getByText("33 % décrit").waitFor();
      assert.equal(await customers.getByLabel("Responsable de customers", { exact: true }).inputValue(), "equipe-crm");

      // Filters: what is left to document, and where the personal data is.
      await panel.getByRole("radio", { name: "Données personnelles" }).click();
      await panel.locator('[data-table="orders"]').waitFor({ state: "detached" });
      assert.equal(await customers.count(), 1);
      await panel.getByRole("radio", { name: "À documenter" }).click();
      await panel.locator('[data-table="orders"]').waitFor();
      assert.equal(await customers.count(), 1, "customers still has an undescribed column");
      await panel.getByRole("radio", { name: "Toutes" }).click();
      // Enums are listed after the tables, with what each value means; the search covers them too.
      const status = panel.locator('[data-enum="order_status"]');
      await status.getByText("Commande réglée").waitFor();
      await status.getByText("Utilisée par aucune colonne").waitFor();
      await panel.getByRole("searchbox").fill("coeur");
      await panel.locator('[data-table="orders"]').waitFor({ state: "detached" });
      assert.equal(await status.count(), 0);
      await panel.getByRole("searchbox").fill("réglée");
      await status.waitFor();
      assert.equal(await customers.count(), 0);
      await panel.getByRole("searchbox").fill("");

      // The exported document.
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        panel.getByRole("button", { name: "Markdown" }).click(),
      ]);
      assert.equal(download.suggestedFilename(), "Boutique-dictionary.md");
      const markdown = readFileSync(await download.path(), "utf8");
      assert.ok(
        markdown.includes("**Owner:** equipe-crm · **Classification:** personal · **Tags:** rgpd, coeur"),
        markdown,
      );
      assert.ok(
        markdown.includes("| `email` | varchar(320) | not null | sensitive | Adresse de connexion. |"),
        markdown,
      );
      assert.ok(markdown.includes("| `customer_id` | integer | fk → customers.id |"), markdown);
      assert.ok(markdown.includes("## order_status"), markdown);
      assert.ok(markdown.includes("| `paid` | Commande réglée |"), markdown);

      // The linter no longer asks for a description of the table that has one.
      await page.getByRole("tab", { name: /Problèmes/ }).click();
      const problems = page.getByTestId("problems");
      await problems.locator('[data-table="orders"] [data-rule="table-description"]').waitFor();
      assert.equal(await problems.locator('[data-table="customers"] [data-rule="table-description"]').count(), 0);

      assert.deepEqual(errors, []);
    } finally {
      await env.teardown();
    }
  },
);
