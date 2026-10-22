import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { clickRevealedOnHover, login, startE2eEnvironment } from "./harness.js";

/**
 * A CSV past 2 MB goes up as a file and is kept on the server: the dialog reads only a sample to choose the
 * columns, sends the file as it is, and reopens on the file it left there.
 * Set `E2E_SHOTS=<dir>` to keep a screenshot.
 */

const PORT = Number(process.env.E2E_PORT) || 4457;

test("seeds: a CSV over 2 MB is sent as a file, kept on the server and shown again", { timeout: 120_000 }, async () => {
  const env = await startE2eEnvironment(PORT);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(20_000);
    await login(page, env.baseUrl);
    const projectId = await page.evaluate(async () => {
      const json = { "content-type": "application/json" };
      const created = await fetch("/api/projects", { method: "POST", headers: json, body: JSON.stringify({ name: "Boutique" }) });
      const { id } = (await created.json()) as { id: string };
      await fetch(`/api/projects/${id}/import`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ source: "Table customers {\n  id int [pk]\n  name varchar(30)\n}\n" }),
      });
      return id;
    });

    await page.goto(`${env.baseUrl}/project/${projectId}`);
    const node = page.locator(".svelte-flow__node").filter({ hasText: "customers" });
    await clickRevealedOnHover(node, node.getByRole("button", { name: "Paramètres de la table" }));
    await page.getByRole("button", { name: "Données initiales (CSV)" }).click();
    const dialog = page.getByRole("dialog", { name: "Données initiales — customers" });
    await dialog.waitFor();

    const ROWS = 140_000;
    const lines = ["id,name"];
    for (let i = 1; i <= ROWS; i++) lines.push(`${i},Customer ${i}`);
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "customers-big.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(lines.join("\n")),
    });
    await dialog.getByText("customers-big.csv").waitFor();
    await dialog.getByText("volumineux", { exact: false }).first().waitFor();
    await dialog.getByText("Contrôle de l’extrait seulement", { exact: false }).waitFor();
    await dialog.getByRole("table", { name: "Aperçu" }).getByText("Customer 2", { exact: true }).waitFor();
    if (process.env.E2E_SHOTS) await page.screenshot({ path: join(process.env.E2E_SHOTS, "seed-large.png") });

    await dialog.getByRole("button", { name: "Enregistrer" }).click();
    await dialog.waitFor({ state: "detached" });
    await page.getByText(`${ROWS.toLocaleString("fr-FR")} lignes`, { exact: false }).first().waitFor().catch(() => {});

    // The server holds it as a file, with every row counted.
    const seed = await page.evaluate(async (id) => {
      const list = (await (await fetch(`/api/projects/${id}/seeds`)).json()) as {
        seeds: { storage: string; rowCount: number }[];
      };
      return list.seeds[0];
    }, projectId);
    assert.equal(seed.storage, "file");
    assert.equal(seed.rowCount, ROWS);

    // Reopened: it shows the file on the server, not an empty dialog nor its megabytes.
    await node.getByRole("button", { name: /Données initiales : / }).click();
    const again = page.getByRole("dialog", { name: "Données initiales — customers" });
    await again.waitFor();
    await again.getByText("Fichier conservé sur le serveur").first().waitFor();
    await again.getByRole("table", { name: "Aperçu" }).getByText("Customer 3", { exact: true }).waitFor();
  } finally {
    await env.teardown();
  }
});
