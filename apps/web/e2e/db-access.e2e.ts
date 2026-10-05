import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Database access for members: an instance administrator grants a member
 * read access to one database from Admin → Utilisateurs, and the member then
 * queries it from the project's "Données & SQL" tab — explorer and SQL, read
 * only, with nothing of the rest of the console (accounts, sessions, backups,
 * drops) on offer. The server-side rules (refusals, write confirmation, teams,
 * revocation) are covered in `apps/server/src/modules/dbAccess/routes.test.ts`;
 * this checks the wiring a person goes through.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each stage.
 */

const PORT = Number(process.env.E2E_PORT) || 4441;
const MEMBER_EMAIL = "analyste@example.com";
const MEMBER_PASSWORD = "correct horse battery staple analyst";

test("admin grants a member read access; the member queries the database read-only", { timeout: 120_000 }, async () => {
  const targetDir = mkdtempSync(join(tmpdir(), "athanordb-e2e-access-"));
  const targetFile = join(targetDir, "shop.sqlite");
  const target = new Database(targetFile);
  target.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO customers (name) VALUES ('Ada'), ('Linus');
  `);
  target.close();

  const env = await startE2eEnvironment(PORT);
  try {
    const admin = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
    admin.setDefaultTimeout(15_000);
    let shot = 0;
    const snap = async (page: typeof admin, name: string) => {
      if (process.env.E2E_SHOTS)
        await page.screenshot({ path: join(process.env.E2E_SHOTS, `db-access-${++shot}-${name}.png`) });
    };
    await login(admin, env.baseUrl);

    // No helper functions inside `evaluate`: tsx's keepNames wraps them in a
    // `__name(...)` call that doesn't exist in the page.
    const projectId = await admin.evaluate(
      async ({ filePath, email, password }) => {
        const json = { "content-type": "application/json" };
        const created = await fetch("/api/projects", {
          method: "POST",
          headers: json,
          body: JSON.stringify({ name: "Boutique" }),
        });
        const { id } = (await created.json()) as { id: string };
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
        const invited = await fetch("/api/invitations", {
          method: "POST",
          headers: json,
          body: JSON.stringify({ email }),
        });
        const { token } = (await invited.json()) as { token: string };
        const accepted = await fetch(`/api/invitations/${token}/accept`, {
          method: "POST",
          headers: json,
          body: JSON.stringify({ password }),
        });
        if (!accepted.ok) throw new Error(`accept failed: ${accepted.status} ${await accepted.text()}`);
        return id;
      },
      { filePath: targetFile, email: MEMBER_EMAIL, password: MEMBER_PASSWORD },
    );

    // The member, in their own browser context: in the project, but no database yet.
    const memberContext = await env.browser.newContext({ viewport: { width: 1400, height: 900 } });
    const member = await memberContext.newPage();
    member.setDefaultTimeout(15_000);
    await member.goto(env.baseUrl);
    await member.getByLabel("Adresse e-mail").fill(MEMBER_EMAIL);
    await member.getByLabel("Mot de passe").fill(MEMBER_PASSWORD);
    await member.getByRole("button", { name: "Se connecter" }).click();
    await member.getByRole("button", { name: "Nouveau projet" }).first().waitFor({ timeout: 10_000 });
    const tab = (name: string) => member.getByRole("tab", { name, exact: true });
    await member.goto(`${env.baseUrl}/project/${projectId}`);
    await tab("Historique").waitFor();
    assert.equal(await tab("Données & SQL").count(), 0, "being in the project gives no access to its database");

    // The administrator grants read access from Admin → Utilisateurs.
    await admin.getByRole("button", { name: "Admin", exact: true }).click();
    await admin.getByRole("button", { name: "Utilisateurs", exact: true }).click();
    await admin.getByRole("button", { name: `Accès aux bases de ${MEMBER_EMAIL.split("@")[0]}` }).click();
    const dialog = admin.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Accès à « Base boutique »" }).click();
    await admin.getByRole("option", { name: "Lecture", exact: true }).click();
    await dialog.getByRole("textbox", { name: "Compte SQL proposé sur « Base boutique »" }).fill("analyste_ro");
    await snap(admin, "grant");
    await dialog.getByRole("button", { name: "Enregistrer" }).click();
    await dialog.waitFor({ state: "detached" });

    // The member now has the tab, on read-only terms.
    await member.reload();
    await tab("Données & SQL").click();
    await member.getByRole("button", { name: /customers/ }).click();
    await member.getByRole("gridcell", { name: "Linus" }).waitFor();
    // Reading only: no drop, and none of the administrator's sections.
    assert.equal(await member.getByRole("button", { name: "Supprimer", exact: true }).count(), 0);
    assert.equal(await member.getByRole("tab", { name: "Sauvegardes" }).count(), 0);
    await snap(member, "explorer");

    await member.getByRole("tab", { name: "Console SQL" }).click();
    await member.getByText("Votre accès : lecture seule").waitFor();
    assert.equal(
      await member.getByRole("switch", { name: "Mode écriture" }).count(),
      0,
      "no write mode on read access",
    );
    const editor = member.getByRole("textbox", { name: "Console SQL" });
    await editor.fill("SELECT name FROM customers ORDER BY id");
    await member.getByRole("button", { name: "Exécuter", exact: true }).click();
    await member.getByRole("gridcell", { name: "Ada" }).waitFor();
    await editor.fill("DELETE FROM customers");
    await member.getByRole("button", { name: "Exécuter", exact: true }).click();
    // Said in terms of their access, not "switch to write mode": they have none.
    await member.getByText("Votre accès à cette base est en lecture seule.").waitFor();
    await snap(member, "sql");

    const after = new Database(targetFile, { readonly: true });
    const count = (after.prepare("SELECT COUNT(*) AS n FROM customers").get() as { n: number }).n;
    after.close();
    assert.equal(count, 2, "nothing was deleted");
  } finally {
    await env.teardown();
    rmSync(targetDir, { recursive: true, force: true });
  }
});
