import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { Page } from "playwright-core";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * "Structure goes through the schema", in the database console, against a
 * real SQLite file that a project models.
 *
 * By default a table change is not run: the console says so and links to the
 * project, which opens on the table in question. Switched to "warn", the same
 * statement runs after an explicit confirmation. That the server applies the
 * rule whatever the UI does — and records the out-of-schema run — is covered
 * in `modules/dbAdmin/routes.test.ts`.
 */

const PORT = Number(process.env.E2E_PORT) || 4405;

const SCHEMA = `Table customers {
  id int [pk]
  name varchar
}

Table invoices {
  id int [pk]
  customer_id int [ref: > customers.id]
}
`;

const tablesOf = (file: string) => {
  const db = new Database(file, { readonly: true });
  try {
    return (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]
    ).map((row) => row.name);
  } finally {
    db.close();
  }
};

async function openConsole(page: Page, baseUrl: string): Promise<void> {
  await page.goto(baseUrl);
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await page.getByRole("button", { name: "Connexions base de données" }).click();
  await page.getByRole("button", { name: "Ouvrir" }).click();
  await page.getByRole("button", { name: /invoices/ }).waitFor();
}

test(
  "console: a table change is sent to the schema by default, and runs after confirmation under `warn`",
  { timeout: 90_000 },
  async () => {
    const targetDir = mkdtempSync(join(tmpdir(), "athanordb-e2e-policy-"));
    const targetFile = join(targetDir, "shop.sqlite");
    const target = new Database(targetFile);
    target.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE invoices (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id));
  `);
    target.close();

    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
      page.setDefaultTimeout(15_000);
      // The console confirms a write-mode run with a native dialog.
      page.on("dialog", (dialog) => void dialog.accept());
      await login(page, env.baseUrl);

      // A project modelling the database, and the connection attached to it.
      // No helper functions inside `evaluate`: tsx's keepNames wraps them in a
      // `__name(...)` call that doesn't exist in the page.
      await page.evaluate(
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
            body: JSON.stringify({ name: "Base boutique", engine: "sqlite", filePath }),
          });
          const connectionId = ((await connection.json()) as { connection: { id: string } }).connection.id;
          const linked = await fetch(`/api/admin/connections/${connectionId}/projects`, {
            method: "PUT",
            headers: json,
            body: JSON.stringify({ projectIds: [id] }),
          });
          if (!linked.ok) throw new Error(`link failed: ${linked.status}`);
        },
        { dbml: SCHEMA, filePath: targetFile },
      );

      // --- Default policy: explorer ---
      await openConsole(page, env.baseUrl);
      await page.getByText("Via le schéma uniquement", { exact: true }).waitFor();
      await page.getByRole("button", { name: /invoices/ }).click();
      await page.getByRole("button", { name: "Supprimer", exact: true }).click();
      const redirect = page.getByRole("dialog", { name: "Modifier la structure" });
      await redirect.getByText("Cette base est pilotée par le schéma « Boutique ».").waitFor();
      await redirect.getByText("supprimer la table invoices").waitFor();
      await redirect.getByRole("button", { name: "Annuler" }).click();

      // --- Default policy: typed SQL, write mode ---
      await page.getByRole("tab", { name: "Console SQL" }).click();
      const editor = page.getByRole("textbox", { name: "Console SQL" });
      await page.getByRole("switch", { name: "Mode écriture" }).click();
      await editor.fill("ALTER TABLE invoices ADD COLUMN note TEXT");
      await page.getByRole("button", { name: "Exécuter", exact: true }).click();
      await redirect.getByText("modifier la table invoices").waitFor();
      assert.deepEqual(tablesOf(targetFile), ["customers", "invoices"]);

      // The link opens the project on that table.
      await redirect.getByRole("link", { name: "Ouvrir dans le schéma « Boutique »" }).click();
      await page.waitForURL(/\/project\/[^/?]+\?table=invoices$/);
      const node = page.locator(".svelte-flow__node").filter({ hasText: "invoices" });
      await node.waitFor();
      await page.locator(".svelte-flow__node.selected").filter({ hasText: "invoices" }).waitFor();

      // --- Relax the instance default to "warn" ---
      await page.goto(env.baseUrl);
      await page.getByRole("button", { name: "Admin", exact: true }).click();
      await page.getByRole("button", { name: "Connexions base de données" }).click();
      await page.getByRole("combobox", { name: "Structure des bases liées à un projet" }).click();
      await page.getByRole("option", { name: /Avertir/ }).click();
      await page.getByText("Politique de structure par défaut enregistrée.").waitFor();

      await page.getByRole("button", { name: "Ouvrir" }).click();
      await page.getByRole("tab", { name: "Console SQL" }).click();
      await page.getByRole("switch", { name: "Mode écriture" }).click();
      await editor.fill("ALTER TABLE invoices ADD COLUMN note TEXT");
      await page.getByRole("button", { name: "Exécuter", exact: true }).click();
      const confirm = page.getByRole("dialog", { name: "Modifier la structure hors du schéma ?" });
      await confirm.getByText(/modifier la table invoices/).waitFor();
      const columns = () => {
        const db = new Database(targetFile, { readonly: true });
        try {
          return (db.prepare("PRAGMA table_info(invoices)").all() as { name: string }[]).map((c) => c.name);
        } finally {
          db.close();
        }
      };
      assert.deepEqual(columns(), ["id", "customer_id"], "nothing ran before the confirmation");
      await confirm.getByRole("button", { name: "Exécuter quand même" }).click();
      await confirm.waitFor({ state: "detached" });
      await assertEventually(() => columns().includes("note"), "the confirmed statement ran");

      // --- The project is told its database left the schema ---
      await page.goto(env.baseUrl);
      await page.getByText("Boutique", { exact: true }).click();
      const banner = page.getByRole("status").filter({ hasText: "a été modifiée en dehors du schéma" });
      await banner.getByText("La base « Base boutique » a été modifiée en dehors du schéma").waitFor();
      await banner.getByText(/1 différence avec le schéma/).waitFor();
      // Read in the DBML panel: the canvas shows only key columns at the default detail level.
      const dbml = page.locator(".cm-content");
      await dbml.getByText("customer_id").first().waitFor();
      assert.equal(await dbml.getByText("note", { exact: true }).count(), 0, "the schema does not know the column yet");

      // Resynchronising brings the schema to the database, and the banner goes without a reload.
      await banner.getByRole("button", { name: "Resynchroniser" }).click();
      const resync = page.getByRole("dialog", { name: "Resynchroniser le schéma depuis la base ?" });
      await resync.getByRole("button", { name: "Resynchroniser" }).click();
      await banner.waitFor({ state: "detached" });
      await dbml.getByText("note", { exact: true }).waitFor();
    } finally {
      await env.teardown();
      rmSync(targetDir, { recursive: true, force: true });
    }
  },
);

async function assertEventually(check: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(message);
}
