import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Initial data: a CSV is chosen for a table, its columns are matched by
 * name, the preview flags what would not fit, the table shows it has rows to
 * bring, the deployment plan says how many, and the rows end up in the
 * database — parents before children.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each step.
 */

const PORT = Number(process.env.E2E_PORT) || 4413;

const SCHEMA = `Table customers {
  id integer [pk]
  name varchar(20) [not null]
}

Table orders {
  id integer [pk]
  customer_id integer [ref: > customers.id]
}
`;

test("seeds: CSV in the editor, checked, shown on the table, deployed", { timeout: 90_000 }, async () => {
  const targetFile = join(mkdtempSync(join(tmpdir(), "athanordb-e2e-seeds-")), "shop.sqlite");
  const env = await startE2eEnvironment(PORT);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    let shot = 0;
    const snap = async (name: string) => {
      if (process.env.E2E_SHOTS)
        await page.screenshot({ path: join(process.env.E2E_SHOTS, `seeds-${++shot}-${name}.png`) });
    };
    await login(page, env.baseUrl);

    const projectId = await page.evaluate(
      async ({ dbml, filePath }) => {
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
          body: JSON.stringify({ source: dbml }),
        });
        await fetch(`/api/projects/${id}/connections`, {
          method: "POST",
          headers: json,
          body: JSON.stringify({ name: "Base boutique", engine: "sqlite", filePath }),
        });
        return id;
      },
      { dbml: SCHEMA, filePath: targetFile },
    );

    await page.goto(`${env.baseUrl}/project/${projectId}`);
    const node = (name: string) => page.locator(".svelte-flow__node").filter({ hasText: name });
    await node("customers").hover();
    await node("customers").getByRole("button", { name: "Données initiales (CSV)" }).click();
    const dialog = page.getByRole("dialog", { name: "Données initiales — customers" });
    await dialog.waitFor();

    // A name too long for varchar(20) is flagged before anything is saved.
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "clients.csv",
      mimeType: "text/csv",
      buffer: Buffer.from('ID;Name\n1;Ada\n2;"Grace Hopper, the admiral"\n'),
    });
    await dialog.getByText("clients.csv").waitFor();
    await dialog.getByText("2 lignes").waitFor();
    await dialog.getByText("1 problème").waitFor();
    await dialog.getByText("plus long que ce que la colonne permet", { exact: false }).waitFor();
    await snap("issue");

    await dialog.locator('input[type="file"]').setInputFiles({
      name: "clients.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("ID;Name\n1;Ada\n2;Grace\n"),
    });
    await dialog.getByText("Toutes les lignes conviennent à la table.").waitFor();
    await dialog.getByRole("table", { name: "Aperçu" }).getByText("Grace").waitFor();
    await snap("valid");
    await dialog.getByRole("button", { name: "Enregistrer" }).click();
    await dialog.waitFor({ state: "detached" });

    // The table says it brings rows, at rest.
    await node("customers").getByRole("button", { name: "Données initiales : 2 lignes" }).waitFor();

    // orders: generated rows, their customer drawn from the customers' initial data.
    await node("orders").hover();
    await node("orders").getByRole("button", { name: "Données initiales (CSV)" }).click();
    const orders = page.getByRole("dialog", { name: "Données initiales — orders" });
    await orders.getByRole("tab", { name: "Générer" }).click();
    await orders.getByRole("spinbutton", { name: "Lignes" }).fill("8");
    await orders.getByRole("spinbutton", { name: "Lignes" }).blur();
    await orders.getByRole("button", { name: "Aperçu" }).click();
    await orders.getByRole("table", { name: "Lignes générées" }).waitFor();
    await snap("generated");
    await orders.getByRole("button", { name: "Utiliser comme données initiales (8 lignes)" }).click();
    await orders.getByText("Toutes les lignes conviennent à la table.").waitFor();
    await orders.getByRole("button", { name: "Enregistrer" }).click();
    await orders.waitFor({ state: "detached" });

    // The plan counts them, parents first; the deployment inserts them.
    await page.getByRole("button", { name: "Déployer", exact: true }).first().click();
    const modal = page.getByRole("dialog").first();
    await modal.getByTestId("seed-plan").getByText("customers : +2 lignes").waitFor();
    await modal.getByTestId("seed-plan").getByText("orders : +8 lignes").waitFor();
    await snap("plan");
    await modal.getByRole("button", { name: "Prévisualiser le SQL" }).click();
    await modal.getByRole("button", { name: "Appliquer les modifications en base" }).click();
    await modal.getByTestId("seed-report").getByText("customers : +2 lignes").waitFor();
    await modal.getByTestId("seed-report").getByText("orders : +8 lignes").waitFor();
    await snap("deployed");

    const target = new Database(targetFile, { readonly: true });
    assert.deepEqual(target.prepare("SELECT id, name FROM customers ORDER BY id").all(), [
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
    const customerIds = (target.prepare("SELECT DISTINCT customer_id AS c FROM orders").all() as { c: number }[]).map(
      (row) => row.c,
    );
    assert.ok(
      customerIds.every((id) => id === 1 || id === 2),
      `orders point at existing customers: ${customerIds}`,
    );
    target.close();
    assert.deepEqual(errors, []);
  } finally {
    await env.teardown();
  }
});
