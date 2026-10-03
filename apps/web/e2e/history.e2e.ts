import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * The history tab as a timeline: close edits by one person read as one line
 * that opens into its steps, a revision can be previewed on the diagram
 * (tables added / changed since outlined, tables deleted since named), one
 * table can be brought back without the rest, and that restore then shows on
 * the timeline.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each step.
 */

const PORT = Number(process.env.E2E_PORT) || 4410;

const V1 = `Table customers {
  id int [pk]
  name varchar
}

Table invoices {
  id int [pk]
  customer_id int [ref: > customers.id]
}
`;

// customers gains a column, products appears, invoices goes.
const V2 = `Table customers {
  id int [pk]
  name varchar
  email varchar
}

Table products {
  id int [pk]
}
`;

test("history: grouped timeline, preview on the diagram, one table restored", { timeout: 90_000 }, async () => {
  const env = await startE2eEnvironment(PORT);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    let shot = 0;
    const snap = async (name: string) => {
      if (process.env.E2E_SHOTS)
        await page.screenshot({ path: join(process.env.E2E_SHOTS, `history-${++shot}-${name}.png`) });
    };
    await login(page, env.baseUrl);

    // No helper functions inside `evaluate`: tsx's keepNames wraps them in a
    // `__name(...)` call that doesn't exist in the page.
    const projectId = await page.evaluate(
      async ({ v1, v2 }) => {
        const json = { "content-type": "application/json" };
        const created = await fetch("/api/projects", {
          method: "POST",
          headers: json,
          body: JSON.stringify({ name: "Historique" }),
        });
        const { id } = (await created.json()) as { id: string };
        for (const source of [v1, v2]) {
          await fetch(`/api/projects/${id}/import`, {
            method: "POST",
            headers: json,
            body: JSON.stringify({ source }),
          });
        }
        return id;
      },
      { v1: V1, v2: V2 },
    );

    await page.goto(`${env.baseUrl}/project/${projectId}/history`);
    const entries = page.getByTestId("history-entry");
    await entries.first().waitFor();
    // Two imports a moment apart, same person: one line, two steps.
    assert.equal(await entries.count(), 1);
    await entries.first().getByText("2 étapes").waitFor();
    await entries.first().getByText("Vous").waitFor();
    // "Mes modifications" keeps it: it is ours.
    await page.getByText("Mes modifications", { exact: true }).click();
    assert.equal(await page.getByRole("checkbox", { name: "Mes modifications" }).isChecked(), true);
    assert.equal(await entries.count(), 1);
    await page.getByText("Mes modifications", { exact: true }).click();

    // Open the line and pick its first step: the schema as V1 left it.
    await entries.first().getByRole("button", { name: "Afficher les 2 étapes" }).click();
    const steps = entries.first().locator("ul button");
    assert.equal(await steps.count(), 2);
    await steps.last().click();
    const changes = page.getByText("Modifications depuis cette version").locator("..");
    await changes.getByText("- Table invoices").waitFor();
    await changes.getByText("~ Table customers").waitFor();
    await changes.getByText("+ Table products").waitFor();
    await snap("timeline");

    // --- Preview on the diagram ---
    await page.getByRole("button", { name: "Aperçu sur le graphe" }).click();
    await page.waitForURL(`**/project/${projectId}`);
    const banner = page.getByTestId("history-preview");
    await banner.waitFor();
    await banner.getByText("1 table ajoutée").waitFor();
    await banner.getByText("1 table modifiée").waitFor();
    const node = (name: string) => page.locator(".svelte-flow__node").filter({ hasText: name });
    await node("products").waitFor();
    assert.match((await node("products").getAttribute("class")) ?? "", /history-diff-added/);
    assert.match((await node("customers").getAttribute("class")) ?? "", /history-diff-changed/);
    await snap("preview");

    // invoices is not on the canvas: the strip names it, and brings it back alone.
    await banner.getByText("Supprimées depuis :").waitFor();
    await banner.getByRole("button", { name: "remettre" }).click();
    await page.getByText("« invoices » restaurée à la version du", { exact: false }).waitFor();
    await node("invoices").waitFor();
    // The rest stayed as it is now: products is still there, customers still has email.
    await node("products").waitFor();
    const tables = await page.evaluate(async (id) => {
      const snapshot = await fetch(`/api/projects/${id}/snapshot`);
      return ((await snapshot.json()) as { tables: { name: string; fields: { name: string }[] }[] }).tables.map(
        (table) => `${table.name}(${table.fields.map((field) => field.name).join(",")})`,
      );
    }, projectId);
    assert.deepEqual(tables.sort(), ["customers(id,name,email)", "invoices(id,customer_id)", "products(id)"]);
    await banner.getByText("Supprimées depuis :").waitFor({ state: "detached" });
    await snap("restored-one");

    // --- Back to the history: same revision, and the restore is on the timeline ---
    await banner.getByRole("button", { name: "Retour à l'historique" }).click();
    await page.waitForURL(`**/project/${projectId}/history`);
    const marker = page.locator('[data-testid="history-marker"][data-kind="restore"]');
    await marker.waitFor();
    await marker.getByText("invoices restaurée(s) à la version du", { exact: false }).waitFor();
    // Newest first: the state the restore wrote, the restore, then the two imports.
    assert.deepEqual(
      await page
        .locator('[data-testid="history-entry"], [data-testid="history-marker"]')
        .evaluateAll((items) => items.map((item) => item.getAttribute("data-testid"))),
      ["history-entry", "history-marker", "history-entry"],
    );
    await changes.getByText("~ Table customers").waitFor();
    assert.equal(await changes.getByText("Table invoices").count(), 0, "invoices matches the revision again");
    await snap("marker");

    // Closing the preview leaves the diagram unmarked.
    await page.getByRole("tab", { name: "Schéma", exact: true }).click();
    await page.getByTestId("history-preview").getByRole("button", { name: "Fermer l'aperçu" }).click();
    await page.getByTestId("history-preview").waitFor({ state: "detached" });
    assert.doesNotMatch((await node("products").getAttribute("class")) ?? "", /history-diff/);

    assert.deepEqual(errors, []);
  } finally {
    await env.teardown();
  }
});
