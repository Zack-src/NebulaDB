import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clickRevealedOnHover, login, startE2eEnvironment } from "./harness.js";

/**
 * "Voir les données" on a table is offered only once Nebula has deployed the project to the connected
 * database (and only to someone allowed to query it).
 */

const PORT = Number(process.env.E2E_PORT) || 4445;

test("view data: offered only after the project has been deployed to its database", { timeout: 90_000 }, async () => {
  const env = await startE2eEnvironment(PORT);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(15_000);
    await login(page, env.baseUrl);
    const filePath = join(mkdtempSync(join(tmpdir(), "nebula-view-data-")), "shop.sqlite");
    const ids = await page.evaluate(
      async ({ filePath }) => {
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
          body: JSON.stringify({ source: "Table customers {\n  id int [pk]\n}\n" }),
        });
        const connection = await fetch("/api/admin/connections", {
          method: "POST",
          headers: json,
          body: JSON.stringify({ name: "Base boutique", engine: "sqlite", filePath }),
        });
        const connectionId = ((await connection.json()) as { connection: { id: string } }).connection.id;
        await fetch(`/api/admin/connections/${connectionId}/projects`, {
          method: "PUT",
          headers: json,
          body: JSON.stringify({ projectIds: [id] }),
        });
        return { id, connectionId };
      },
      { filePath },
    );

    const table = () => page.locator(".svelte-flow__node").filter({ hasText: "customers" });
    const viewData = () => table().getByRole("button", { name: "Voir les données" });

    // Connected, never deployed: the table has no data of Nebula's to look at.
    await page.goto(`${env.baseUrl}/project/${ids.id}`);
    await table().waitFor();
    await table().hover();
    await page.getByRole("combobox", { name: "Connexion courante" }).getByText("Base boutique").waitFor();
    await table().getByRole("button", { name: "Paramètres de la table" }).waitFor({ state: "attached" });
    assert.equal(await viewData().count(), 0);

    // Deployed: it shows up.
    const deployed = await page.evaluate(
      async ({ id, connectionId }) =>
        (
          await fetch(`/api/projects/${id}/connections/${connectionId}/apply-deployment`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ resolutions: {} }),
          })
        ).status,
      ids,
    );
    assert.equal(deployed, 200);
    await page.reload();
    await table().waitFor();
    await clickRevealedOnHover(table(), viewData());
    await page.getByRole("region", { name: "SQL" }).waitFor();
  } finally {
    await env.teardown();
  }
});
