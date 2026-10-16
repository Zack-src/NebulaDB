import { test } from "node:test";
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * The project list's folders and a project's client variants, the way a
 * person goes through them: a folder made and entered, a project moved into
 * it; a variant made from the "Variantes" tab; the original changed (one
 * change the client also made); the changes sent from the original with the
 * conflict settled in the client's favour; the original and the client
 * compared.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each step.
 */

const PORT = Number(process.env.E2E_PORT) || 4463;

const ORIGINAL = `Table customers {
  id int [pk]
  name varchar
}

Table orders {
  id int [pk]
  customer_id int [ref: > customers.id]
  total numeric
}
`;

async function importDbml(page: Page, projectId: string, source: string) {
  const status = await page.evaluate(
    async ({ id, source }) =>
      (
        await fetch(`/api/projects/${id}/import`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source }),
        })
      ).status,
    { id: projectId, source },
  );
  assert.equal(status, 200);
}

async function exportDbml(page: Page, projectId: string): Promise<string> {
  return page.evaluate(async (id) => (await fetch(`/api/projects/${id}/export/dbml`)).text(), projectId);
}

test(
  "folders and client variants: sorted, copied, kept in step on demand, compared",
  { timeout: 150_000 },
  async () => {
    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage({ viewport: { width: 1400, height: 950 } });
      page.setDefaultTimeout(15_000);
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(String(err)));
      let shot = 0;
      const snap = async (name: string) => {
        if (process.env.E2E_SHOTS)
          await page.screenshot({ path: `${process.env.E2E_SHOTS}/variants-${++shot}-${name}.png` });
      };
      await login(page, env.baseUrl);
      const baseId = await page.evaluate(async () => {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Boutique" }),
        });
        return ((await res.json()) as { id: string }).id;
      });
      await importDbml(page, baseId, ORIGINAL);
      await page.reload();

      // --- A folder, entered, and the project moved into it ---
      await page.getByRole("button", { name: "Nouveau dossier" }).click();
      await page.getByRole("dialog").getByLabel("Nom du dossier").fill("Clients");
      await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
      const folder = page.getByTestId("folder-tile").filter({ hasText: "Clients" });
      await folder.waitFor();
      await page.getByRole("button", { name: "Déplacer vers un dossier", exact: true }).click();
      await page.getByTestId("move-project").getByRole("button", { name: "Clients" }).click();
      await folder.getByText("1 projet").waitFor();
      // At the top, only the folder is left; inside it, the project.
      assert.equal(await page.getByText("Boutique", { exact: true }).count(), 0);
      await snap("folder");
      await folder.getByRole("button", { name: /^Clients/ }).click();
      await page.getByRole("navigation", { name: "Dossiers" }).getByRole("button", { name: "Clients" }).waitFor();
      await page.getByText("Boutique", { exact: true }).click();

      // --- A client variant, from the original's "Variantes" tab ---
      await page.getByRole("tab", { name: "Variantes" }).click();
      await page.getByText("Aucune variante pour l'instant", { exact: false }).waitFor();
      await page.getByRole("button", { name: "Nouvelle variante client" }).click();
      await page.getByRole("dialog").getByLabel("Nom de la variante").fill("Boutique — Client A");
      await page.getByRole("dialog").getByRole("button", { name: "Créer" }).click();
      // Listed under the original, up to date; opened, it says whose variant it is.
      const created = page.getByTestId("variant-row").filter({ hasText: "Boutique — Client A" });
      await created.getByText("À jour").waitFor();
      await created.getByRole("button", { name: "Ouvrir" }).click();
      await page.getByRole("tab", { name: "Variantes" }).click();
      await page.getByTestId("variant-original").getByRole("button", { name: "Boutique" }).waitFor();
      const variantId = new URL(page.url()).pathname.split("/")[2];
      assert.notEqual(variantId, baseId);
      assert.equal(await exportDbml(page, variantId), await exportDbml(page, baseId));
      await snap("variant");

      // The client makes "name" their own; the original changes it too, and adds a column.
      await importDbml(page, variantId, ORIGINAL.replace("name varchar", "name varchar(255)"));
      await importDbml(
        page,
        baseId,
        ORIGINAL.replace("name varchar", "name varchar(100)").replace(
          "total numeric",
          "total numeric\n  status varchar",
        ),
      );

      // --- Back on the original: the variant is behind, with one conflict ---
      await page.getByTestId("variant-original").getByRole("button", { name: "Boutique" }).click();
      await page.getByRole("tab", { name: "Variantes" }).click();
      const row = page.getByTestId("variant-row").filter({ hasText: "Boutique — Client A" });
      await row.getByText("2 changements à recevoir").waitFor();
      await row.getByText("1 conflit").waitFor();
      await row.getByText("1 adaptation client").waitFor();
      await snap("behind");

      await row.getByText("Boutique — Client A", { exact: true }).click();
      await page.getByRole("button", { name: "Envoyer les changements à 1 variante" }).click();
      const sync = page.getByTestId("variant-sync");
      const changes = sync.getByTestId("variant-change");
      await changes.first().waitFor();
      assert.equal(await changes.count(), 2);
      await sync.getByText("Le client l'a aussi modifié.").waitFor();
      await sync.getByText("1 changement sera appliqué").waitFor();
      await snap("sync");
      await sync.getByRole("button", { name: "Envoyer", exact: true }).click();
      await sync
        .getByTestId("variant-sync-results")
        .getByText("1 changement(s) appliqué(s), 1 laissé(s) au client")
        .waitFor();
      await page.getByRole("dialog").getByRole("button", { name: "Fermer" }).last().click();
      await row.getByText("À jour").waitFor();

      const variant = await exportDbml(page, variantId);
      assert.match(variant, /name\s+varchar\(255\)/, "the client's own type is kept");
      assert.match(variant, /status\s+varchar/, "the original's new column arrived");

      // --- Original against client ---
      await row.getByRole("button", { name: "Comparer" }).click();
      const compare = page.getByTestId("variant-compare");
      const table = compare.getByTestId("diff-table");
      await table.getByText("customers", { exact: true }).waitFor();
      assert.equal(await table.count(), 1);
      await table.getByText("varchar(100)").waitFor();
      await table.getByText("varchar(255)").waitFor();
      await snap("compare");

      assert.deepEqual(errors, []);
    } finally {
      await env.teardown();
    }
  },
);
