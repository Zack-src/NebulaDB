import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * The project workspace: one bar of tabs over the schema editor, the database
 * console, the deployments and the history — each with its own URL.
 *
 * Driven in a browser because what matters is the wiring: a tab is a real
 * address (reload and back / forward work), the editor comes back intact after
 * a detour through another tab, and a structural change attempted in the
 * console lands on the schema tab with the table selected, without leaving
 * the page.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each tab.
 */

const PORT = Number(process.env.E2E_PORT) || 4406;

const SCHEMA = `Table customers {
  id int [pk]
  name varchar
}

Table invoices {
  id int [pk]
  customer_id int [ref: > customers.id]
}
`;

test(
  "workspace: tabs are addresses, the editor survives a detour, and the console hands structure back to the schema",
  { timeout: 90_000 },
  async () => {
    const targetDir = mkdtempSync(join(tmpdir(), "athanordb-e2e-workspace-"));
    const targetFile = join(targetDir, "shop.sqlite");
    const target = new Database(targetFile);
    target.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE invoices (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id));
    INSERT INTO customers (name) VALUES ('Ada');
  `);
    target.close();

    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
      page.setDefaultTimeout(15_000);
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(String(err)));
      let shot = 0;
      const snap = async (name: string) => {
        if (process.env.E2E_SHOTS)
          await page.screenshot({ path: join(process.env.E2E_SHOTS, `workspace-${++shot}-${name}.png`) });
      };
      await login(page, env.baseUrl);

      // No helper functions inside `evaluate`: tsx's keepNames wraps them in a
      // `__name(...)` call that doesn't exist in the page.
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
          const connection = await fetch("/api/admin/connections", {
            method: "POST",
            headers: json,
            body: JSON.stringify({ name: "Base boutique", engine: "sqlite", filePath, environment: "Prod" }),
          });
          const connectionId = ((await connection.json()) as { connection: { id: string } }).connection.id;
          await fetch(`/api/admin/connections/${connectionId}/projects`, {
            method: "PUT",
            headers: json,
            body: JSON.stringify({ projectIds: [id] }),
          });
          return id;
        },
        { dbml: SCHEMA, filePath: targetFile },
      );

      await page.goto(`${env.baseUrl}/project/${projectId}`);
      const tab = (name: string) => page.getByRole("tab", { name, exact: true });
      const canvasTable = (name: string) => page.locator(".svelte-flow__node").filter({ hasText: name });
      await canvasTable("invoices").waitFor();
      for (const name of ["Schéma", "Données & SQL", "Déploiements", "Historique"]) await tab(name).waitFor();
      assert.equal(await tab("Schéma").getAttribute("aria-selected"), "true");
      const avatars = page.locator(".account-avatar");
      assert.equal(await avatars.count(), 2);
      assert.equal(await avatars.nth(0).textContent(), await avatars.nth(1).textContent());
      assert.equal(await page.locator("header [role=img]").count(), 0);
      await page.locator("[data-sync-state]").waitFor();
      assert.equal(await page.locator("[data-sync-state]").count(), 1);
      // The current connection and its environment are in view on every tab.
      await page.getByRole("combobox", { name: "Connexion courante" }).getByText("Base boutique").waitFor();
      await page.getByText("Prod", { exact: true }).waitFor();
      await snap("schema");

      // --- SQL panel beside the schema ---
      const drawer = page.getByRole("region", { name: "SQL" });
      assert.equal(await drawer.count(), 0, "closed until asked for");
      await canvasTable("customers").hover();
      await canvasTable("customers").getByRole("button", { name: "Voir les données" }).click();
      await drawer.getByRole("textbox", { name: "Console SQL" }).waitFor();
      assert.equal(
        await drawer.getByRole("textbox", { name: "Console SQL" }).inputValue(),
        "SELECT * FROM customers LIMIT 100",
      );
      await drawer.getByRole("gridcell", { name: "Ada" }).waitFor();
      // The diagram remains beside the read-only panel.
      await canvasTable("invoices").waitFor();
      const panelBox = await drawer.boundingBox();
      const canvasBox = await page.locator(".svelte-flow__pane").boundingBox();
      assert.ok(
        panelBox && canvasBox && panelBox.x >= canvasBox.x + canvasBox.width - 2,
        "SQL opens to the right of the diagram",
      );
      assert.equal(await drawer.getByRole("switch").count(), 0);
      assert.equal(await drawer.getByRole("combobox").count(), 0);
      const historyToggle = drawer.getByRole("button", { name: "Historique", exact: true });
      assert.equal(await historyToggle.getAttribute("aria-expanded"), "false");
      await historyToggle.click();
      const recalled = drawer.getByRole("button", { name: /SELECT \* FROM customers LIMIT 100/ });
      await recalled.waitFor();
      await historyToggle.click();
      await recalled.waitFor({ state: "detached" });
      await historyToggle.click();
      await drawer.getByRole("button", { name: "Effacer l’historique" }).click();
      await drawer.getByText("Aucune requête", { exact: false }).waitFor();
      await recalled.waitFor({ state: "detached" });
      await snap("sql-drawer");
      // Ctrl+J closes and reopens it, from wherever the focus is; the handle is a real separator.
      await page.getByRole("separator", { name: "Redimensionner le panneau SQL" }).waitFor();
      await page.keyboard.press("Control+j");
      await drawer.waitFor({ state: "detached" });
      await page.keyboard.press("Control+j");
      await drawer.waitFor();
      await drawer.getByRole("button", { name: "Fermer" }).click();
      await drawer.waitFor({ state: "detached" });

      // --- History: a page with its own address ---
      await tab("Historique").click();
      await page.waitForURL(`**/project/${projectId}/history`);
      await page.getByRole("button", { name: "Restaurer" }).waitFor();
      assert.equal(await page.locator(".svelte-flow__pane").count(), 0, "the canvas is not mounted behind another tab");
      await snap("history");
      // A reload lands on the same tab…
      await page.reload();
      await page.getByRole("button", { name: "Restaurer" }).waitFor();
      assert.equal(await tab("Historique").getAttribute("aria-selected"), "true");

      // --- Deployments ---
      await tab("Déploiements").click();
      await page.waitForURL(`**/project/${projectId}/deployments`);
      await page.getByRole("heading", { name: "Base boutique" }).waitFor();
      await page.getByRole("button", { name: "Vérifier les différences" }).waitFor();
      await page.getByRole("button", { name: "Déployer" }).first().waitFor();
      await snap("deployments");
      // …and back / forward walk the tabs.
      await page.goBack();
      await page.getByRole("button", { name: "Restaurer" }).waitFor();
      await page.goForward();
      await page.getByRole("heading", { name: "Base boutique" }).waitFor();

      // --- Data & SQL: the console, on the workspace's connection ---
      await tab("Données & SQL").click();
      await page.waitForURL(`**/project/${projectId}/data`);
      await page.getByRole("button", { name: /customers/ }).click();
      await page.getByRole("gridcell", { name: "Ada" }).waitFor();
      await snap("data");

      // A structural change typed here is handed to the schema tab — same page, table selected.
      await page.getByRole("tab", { name: "Console SQL" }).click();
      await page.getByRole("switch", { name: "Mode écriture" }).click();
      await page.getByRole("textbox", { name: "Console SQL" }).fill("ALTER TABLE invoices ADD COLUMN note TEXT");
      await page.evaluate(() => ((window as unknown as { __marker: boolean }).__marker = true));
      await page.getByRole("button", { name: "Exécuter", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Exécuter en écriture" }).click();
      await page.getByRole("link", { name: "Ouvrir dans le schéma « Boutique »" }).click();
      await page.locator(".svelte-flow__node.selected").filter({ hasText: "invoices" }).waitFor();
      assert.equal(await tab("Schéma").getAttribute("aria-selected"), "true");
      assert.equal(new URL(page.url()).pathname, `/project/${projectId}`);
      assert.equal(
        await page.evaluate(() => (window as unknown as { __marker?: boolean }).__marker),
        true,
        "a tab change, not a page load",
      );
      // The editor is whole again: the DBML panel is back with the schema in it.
      await page.locator(".cm-content").getByText("customer_id").first().waitFor();

      assert.deepEqual(errors, [], `expected no page errors, got:\n${errors.join("\n")}`);
    } finally {
      await env.teardown();
      rmSync(targetDir, { recursive: true, force: true });
    }
  },
);
