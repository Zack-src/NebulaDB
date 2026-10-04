import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { Locator, Page } from "playwright-core";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Admin console → "Connexions base de données" → the connection form, for the
 * controls `db-admin.e2e.ts` never clicks: "Lecture seule", the tags, the
 * "Projets rattachés" checkboxes, and for a network engine the port, the SSL
 * checkbox and the "URI" toggle — then the schema import offered next to a
 * linked project, whose confirmation dialog had never been opened by a test.
 *
 * What only a browser can show: every one of these is one of the app's own
 * drawn controls (a hidden `<input>` behind a drawn box, a numeric field with
 * its own stepper, a toggle that swaps half the form), so a click on what the
 * user sees has to reach the request that is sent. No PostgreSQL server is
 * reachable here, so the network fields are checked on what was saved, read
 * back from `/api/admin/connections`, not on a connection test. The import
 * runs for real, against a SQLite file this test creates. The routes
 * themselves are covered in `modules/dbAdmin/routes.test.ts`.
 */

const PORT = Number(process.env.E2E_PORT) || 4426;

interface SavedConnection {
  id: string;
  name: string;
  engine: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  hasPassword: boolean;
  ssl?: boolean;
  connectionString?: string;
  filePath?: string;
  authMode: string;
  tags: string[];
  readOnly: boolean;
  projects: { id: string; name: string }[];
}

/** One connection as the server has it — the only proof of what the form sent. */
async function savedConnection(page: Page, name: string): Promise<SavedConnection> {
  const all = await page.evaluate(async () => {
    const response = await fetch("/api/admin/connections");
    if (!response.ok) throw new Error(`connections: ${response.status}`);
    return ((await response.json()) as { connections: SavedConnection[] }).connections;
  });
  const found = all.find((connection) => connection.name === name);
  assert.ok(found, `no connection named ${name} among ${all.map((c) => c.name).join(", ")}`);
  return found;
}

async function exportedDbml(page: Page, projectId: string): Promise<string> {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/projects/${id}/export/dbml`);
    if (!response.ok) throw new Error(`export: ${response.status}`);
    return response.text();
  }, projectId);
}

/** Waits for a control to show `expected` — never read right after the click that changes it. */
async function shows<T>(read: () => Promise<T>, expected: T, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  let last = await read();
  while (last !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    last = await read();
  }
  assert.equal(last, expected, what);
}

/** The text field under a label the form does not associate with it (`<label>` then `<input>`). */
const fieldUnder = (dialog: Locator, label: string) => dialog.locator(`label:text-is("${label}") + input`);

/** A connection's row in the list: the innermost block holding both its name and its edit button. */
const rowOf = (page: Page, name: string) =>
  page
    .locator("div")
    .filter({ has: page.getByText(name, { exact: true }) })
    .filter({ has: page.getByRole("button", { name: "Modifier" }) })
    .last();

test(
  "admin: the connection form saves what its checkboxes, port and URI toggle show, and imports a schema once confirmed",
  { timeout: 120_000 },
  async () => {
    const targetDir = mkdtempSync(join(tmpdir(), "athanordb-e2e-target-"));
    const targetFile = join(targetDir, "shop.sqlite");
    const target = new Database(targetFile);
    target.exec(`
      CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT);
      CREATE TABLE invoices (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), total REAL);
    `);
    target.close();

    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage({ viewport: { width: 1400, height: 1000 } });
      page.setDefaultTimeout(15_000);
      await login(page, env.baseUrl);

      // Two empty projects: one the connection gets attached to, one it never is.
      const projects = await page.evaluate(async () => {
        const ids: Record<string, string> = {};
        for (const name of ["Vitrine", "Archives"]) {
          const created = await fetch("/api/projects", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name }),
          });
          if (!created.ok) throw new Error(`project ${name}: ${created.status}`);
          ids[name] = ((await created.json()) as { id: string }).id;
        }
        return ids;
      });
      const emptyVitrine = await exportedDbml(page, projects.Vitrine);
      const emptyArchives = await exportedDbml(page, projects.Archives);
      assert.doesNotMatch(emptyVitrine, /Table /);

      await page.getByRole("button", { name: "Admin", exact: true }).click();
      await page.getByRole("button", { name: "Connexions base de données" }).click();
      await page.getByText("Aucune connexion pour le moment.").waitFor();

      const creating = page.getByRole("dialog", { name: "Nouvelle connexion" });
      const editing = page.getByRole("dialog", { name: "Modifier la connexion" });
      const engineOf = (dialog: Locator) => dialog.getByRole("combobox", { name: "Moteur de base de données" });
      const portOf = (dialog: Locator) => dialog.getByRole("spinbutton", { name: "Port" });
      const readOnlyOf = (dialog: Locator) => dialog.getByRole("checkbox", { name: /^Lecture seule/ });
      const sslOf = (dialog: Locator) => dialog.getByRole("checkbox", { name: "Activer SSL / TLS" });
      const uriOf = (dialog: Locator) => dialog.getByRole("checkbox", { name: "Utiliser une URI de connexion" });
      const projectOf = (dialog: Locator, name: string) => dialog.getByRole("checkbox", { name, exact: true });
      const accountMode = (dialog: Locator) => dialog.getByRole("radio", { name: /^Le compte de chacun/ });
      const importButton = { name: "Importer le schéma de la base" };

      // ------------------------------------------------------------------
      // A SQLite connection: read-only, tagged, attached to one project.
      // ------------------------------------------------------------------
      await page.getByRole("button", { name: "Nouvelle connexion" }).click();
      await creating.getByPlaceholder("ex: Production DB").fill("Boutique SQLite");
      await engineOf(creating).click();
      await page.getByRole("option", { name: "SQLite" }).click();
      const filePath = creating.getByPlaceholder("./data/app.sqlite");
      await filePath.waitFor();
      // A file engine has no network fields at all, and no accounts to choose between.
      assert.equal(await portOf(creating).count(), 0);
      assert.equal(await sslOf(creating).count(), 0);
      assert.equal(await uriOf(creating).count(), 0);
      assert.equal(await accountMode(creating).count(), 0);
      await filePath.fill(targetFile);
      await creating.getByPlaceholder("ex. client-a, europe (séparés par des virgules)").fill(" demo ,local,, ");

      // The inputs are visually hidden: the clicks go on the text, as a user's would.
      assert.equal(await readOnlyOf(creating).isChecked(), false);
      await creating.getByText("Lecture seule", { exact: true }).click();
      await shows(() => readOnlyOf(creating).isChecked(), true, "read-only is ticked");

      await projectOf(creating, "Archives").waitFor({ state: "attached" });
      assert.equal(await projectOf(creating, "Vitrine").isChecked(), false);
      await creating.getByText("Vitrine", { exact: true }).click();
      await shows(() => projectOf(creating, "Vitrine").isChecked(), true, "the project is ticked");
      assert.equal(await projectOf(creating, "Archives").isChecked(), false, "its neighbour is untouched");
      // Ticked is not attached: the import is only offered for a link that is already saved.
      assert.equal(await creating.getByRole("button", importButton).count(), 0);

      await creating.getByRole("button", { name: "Enregistrer" }).click();
      await creating.waitFor({ state: "detached" });
      const sqliteRow = rowOf(page, "Boutique SQLite");
      await sqliteRow.getByText("Lecture seule", { exact: true }).waitFor();
      await sqliteRow.getByText("demo", { exact: true }).waitFor();
      await sqliteRow.getByText("local", { exact: true }).waitFor();
      await sqliteRow.getByText("1 projet(s)").waitFor();

      const sqlite = await savedConnection(page, "Boutique SQLite");
      assert.equal(sqlite.engine, "sqlite");
      assert.equal(sqlite.filePath, targetFile);
      assert.equal(sqlite.readOnly, true);
      assert.deepEqual(sqlite.tags, ["demo", "local"]);
      assert.deepEqual(sqlite.projects, [{ id: projects.Vitrine, name: "Vitrine" }]);
      assert.equal(sqlite.authMode, "shared");
      assert.equal(sqlite.host, undefined, "no network setting is stored for a file");
      assert.equal(sqlite.port, undefined, "no network setting is stored for a file");

      // ------------------------------------------------------------------
      // A PostgreSQL connection by host and port, with SSL.
      // ------------------------------------------------------------------
      await page.getByRole("button", { name: "Nouvelle connexion" }).click();
      await creating.getByPlaceholder("ex: Production DB").fill("Réseau PG");
      await portOf(creating).waitFor();
      assert.match(await engineOf(creating).innerText(), /PostgreSQL/);
      assert.equal(await portOf(creating).inputValue(), "5432");
      // The port follows the engine until it is typed.
      await engineOf(creating).click();
      await page.getByRole("option", { name: "MySQL / MariaDB" }).click();
      await shows(() => portOf(creating).inputValue(), "3306", "MySQL's default port");
      await engineOf(creating).click();
      await page.getByRole("option", { name: "PostgreSQL" }).click();
      await shows(() => portOf(creating).inputValue(), "5432", "PostgreSQL's default port");

      await fieldUnder(creating, "Hôte").fill("db.internal");
      await portOf(creating).fill("6543");
      await fieldUnder(creating, "Base de données").fill("shop");
      await fieldUnder(creating, "Utilisateur").fill("app");
      await fieldUnder(creating, "Mot de passe").fill("s3cret-pw");
      assert.equal(await sslOf(creating).isChecked(), false);
      await creating.getByText("Activer SSL / TLS", { exact: true }).click();
      await shows(() => sslOf(creating).isChecked(), true, "SSL is ticked");
      // A network engine with a user and a password can ask everyone for their own account.
      assert.equal(await accountMode(creating).count(), 1);
      assert.equal(await readOnlyOf(creating).isChecked(), false, "a new form starts writable");

      await creating.getByRole("button", { name: "Enregistrer" }).click();
      await creating.waitFor({ state: "detached" });
      await rowOf(page, "Réseau PG").getByText("db.internal:6543/shop").waitFor();

      const network = await savedConnection(page, "Réseau PG");
      assert.equal(network.engine, "postgres");
      assert.equal(network.host, "db.internal");
      assert.equal(network.port, 6543);
      assert.equal(network.database, "shop");
      assert.equal(network.user, "app");
      assert.equal(network.hasPassword, true);
      assert.equal(network.ssl, true);
      assert.equal(network.connectionString, undefined);
      assert.equal(network.readOnly, false);
      assert.deepEqual(network.tags, []);
      assert.deepEqual(network.projects, []);

      // Reopened, the form shows what was saved; SSL unticked and the port stepped are saved in turn.
      await rowOf(page, "Réseau PG").getByRole("button", { name: "Modifier" }).click();
      await portOf(editing).waitFor();
      assert.equal(await portOf(editing).inputValue(), "6543");
      assert.equal(await sslOf(editing).isChecked(), true);
      assert.equal(await uriOf(editing).isChecked(), false);
      assert.equal(await fieldUnder(editing, "Hôte").inputValue(), "db.internal");
      await editing.getByText("Activer SSL / TLS", { exact: true }).click();
      await shows(() => sslOf(editing).isChecked(), false, "SSL is unticked");
      await editing.getByRole("button", { name: "Augmenter" }).click();
      await shows(() => portOf(editing).inputValue(), "6544", "the stepper adds one");
      await editing.getByRole("button", { name: "Enregistrer" }).click();
      await editing.waitFor({ state: "detached" });
      await rowOf(page, "Réseau PG").getByText("db.internal:6544/shop").waitFor();
      const stepped = await savedConnection(page, "Réseau PG");
      assert.equal(stepped.port, 6544);
      assert.equal(stepped.ssl, false);
      assert.equal(stepped.hasPassword, true, "a password left blank is kept");

      // ------------------------------------------------------------------
      // A PostgreSQL connection by URI: the toggle swaps the fields.
      // ------------------------------------------------------------------
      await page.getByRole("button", { name: "Nouvelle connexion" }).click();
      await creating.getByPlaceholder("ex: Production DB").fill("Par URI");
      await portOf(creating).waitFor();
      assert.equal(await uriOf(creating).isChecked(), false);
      await creating.getByText("Utiliser une URI de connexion", { exact: true }).click();
      await shows(() => uriOf(creating).isChecked(), true, "the URI toggle is ticked");
      const uri = fieldUnder(creating, "URI de connexion");
      await uri.waitFor();
      assert.equal(await uri.getAttribute("type"), "password", "the URI carries a password: it is not shown");
      assert.equal(await portOf(creating).count(), 0);
      assert.equal(await sslOf(creating).count(), 0);
      assert.equal(await fieldUnder(creating, "Hôte").count(), 0);
      assert.equal(await accountMode(creating).count(), 0, "no personal account without a user field");
      await uri.fill("postgres://app:s3cret-pw@db.internal:6543/shop");
      await creating.getByRole("button", { name: "Enregistrer" }).click();
      await creating.waitFor({ state: "detached" });
      await rowOf(page, "Par URI").getByText("postgres://app:***@db.internal:6543/shop").waitFor();

      const byUri = await savedConnection(page, "Par URI");
      assert.equal(byUri.engine, "postgres");
      assert.equal(byUri.connectionString, "postgres://app:***@db.internal:6543/shop", "handed back masked");
      assert.equal(byUri.host, undefined, "the hidden host field is not sent");
      assert.equal(byUri.port, undefined, "the hidden port field is not sent");
      assert.equal(byUri.authMode, "shared");

      // Reopened, the toggle is ticked and the URI is the masked one; saving it as is keeps the real one.
      await rowOf(page, "Par URI").getByRole("button", { name: "Modifier" }).click();
      await fieldUnder(editing, "URI de connexion").waitFor();
      assert.equal(await uriOf(editing).isChecked(), true);
      assert.equal(
        await fieldUnder(editing, "URI de connexion").inputValue(),
        "postgres://app:***@db.internal:6543/shop",
      );
      await editing.getByText("Utiliser une URI de connexion", { exact: true }).click();
      await shows(() => uriOf(editing).isChecked(), false, "the URI toggle is unticked");
      await portOf(editing).waitFor();
      assert.equal(await fieldUnder(editing, "URI de connexion").count(), 0);
      await fieldUnder(editing, "Hôte").fill("db2.internal");
      await fieldUnder(editing, "Base de données").fill("shop");
      await fieldUnder(editing, "Utilisateur").fill("app");
      await editing.getByRole("button", { name: "Enregistrer" }).click();
      await editing.waitFor({ state: "detached" });
      const switched = await savedConnection(page, "Par URI");
      assert.equal(switched.host, "db2.internal");
      assert.equal(switched.database, "shop");
      // The URI goes with the toggle: left behind, the driver would prefer it and the connection
      // would still go to the old address.
      assert.equal(switched.connectionString, undefined);

      // ------------------------------------------------------------------
      // Importing the database's schema into the linked project.
      // ------------------------------------------------------------------
      await sqliteRow.getByRole("button", { name: "Modifier" }).click();
      await projectOf(editing, "Archives").waitFor({ state: "attached" });
      assert.equal(await readOnlyOf(editing).isChecked(), true);
      assert.equal(await projectOf(editing, "Vitrine").isChecked(), true);
      assert.equal(await projectOf(editing, "Archives").isChecked(), false);
      assert.equal(await editing.getByPlaceholder("./data/app.sqlite").inputValue(), targetFile);
      // Offered for the linked project only.
      assert.equal(await editing.getByRole("button", importButton).count(), 1);

      const confirm = page.getByRole("dialog", { name: "Importer le schéma de la base dans « Vitrine » ?" });
      const imported = editing.getByText("Schéma importé avec succès (2 tables).");

      // Asked first — and "Annuler" leaves everything as it was.
      await editing.getByRole("button", importButton).click();
      await confirm.getByText(/Voulez-vous vraiment importer le schéma de cette base/).waitFor();
      await confirm.getByRole("button", { name: "Annuler" }).click();
      await confirm.waitFor({ state: "detached" });
      assert.equal(await editing.count(), 1, "the form stays open behind the question");
      assert.equal(await imported.count(), 0);
      assert.equal(await exportedDbml(page, projects.Vitrine), emptyVitrine, "nothing was imported");

      // Confirmed: the project takes the database's tables.
      await editing.getByRole("button", importButton).click();
      await confirm.getByRole("button", { name: "Importer le schéma", exact: true }).click();
      await confirm.waitFor({ state: "detached" });
      await imported.waitFor();
      const dbml = await exportedDbml(page, projects.Vitrine);
      assert.match(dbml, /Table "?customers"? \{/);
      assert.match(dbml, /Table "?invoices"? \{/);
      assert.match(dbml, /email/);
      assert.match(dbml, /customer_id/);
      assert.equal(await exportedDbml(page, projects.Archives), emptyArchives, "the other project is untouched");

      // ------------------------------------------------------------------
      // Unticking: the project is detached and the connection writable again.
      // ------------------------------------------------------------------
      await editing.getByText("Vitrine", { exact: true }).click();
      await shows(() => projectOf(editing, "Vitrine").isChecked(), false, "the project is unticked");
      await editing.getByText("Archives", { exact: true }).click();
      await shows(() => projectOf(editing, "Archives").isChecked(), true, "the other project is ticked");
      await editing.getByText("Lecture seule", { exact: true }).click();
      await shows(() => readOnlyOf(editing).isChecked(), false, "read-only is unticked");
      await editing.getByPlaceholder("ex. client-a, europe (séparés par des virgules)").fill("local");
      await editing.getByRole("button", { name: "Enregistrer" }).click();
      await editing.waitFor({ state: "detached" });
      await sqliteRow.getByText("demo", { exact: true }).waitFor({ state: "detached" });

      const relinked = await savedConnection(page, "Boutique SQLite");
      assert.equal(relinked.readOnly, false);
      assert.deepEqual(relinked.tags, ["local"]);
      assert.deepEqual(relinked.projects, [{ id: projects.Archives, name: "Archives" }]);
      assert.equal(await sqliteRow.getByText("Lecture seule", { exact: true }).count(), 0);
      // Detaching the connection does not take the imported tables back.
      assert.equal(await exportedDbml(page, projects.Vitrine), dbml);
    } finally {
      await env.teardown();
      rmSync(targetDir, { recursive: true, force: true });
    }
  },
);
