import assert from "node:assert/strict";
import { test } from "node:test";
import type { Page } from "playwright-core";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Plugins against a locked table. A plugin is the one way to change a schema
 * that does not go through the canvas's own controls — the controls a lock
 * removes — so it is the one place where the editor happily *sends* a change
 * to a locked table: a canvas command hands back a whole modified project,
 * which is written to the shared document as is.
 *
 * Two people in the same project: an administrator who locks `users`, and an
 * editor the lock binds, who runs
 *  - a built-in canvas command (adds `created_at` / `updated_at` everywhere),
 *  - a canvas command of a plugin they install themselves, which runs in the
 *    sandboxed Worker (prefixes every table name),
 *  - an importer, through the import dialog.
 *
 * What only a browser can show: what the editor actually *sees* — the plugin
 * reports success, the unlocked table changes, the locked one comes back as
 * it was a moment later with a warning saying why — and that the server's
 * correction reaches the canvas without a reload. That the server puts the
 * table back whatever the client sends is covered where it is enforced:
 * `realtime/room.test.ts` and `modules/tableLocks/routes.test.ts`.
 */

const PORT = Number(process.env.E2E_PORT) || 4428;
const EDITOR_EMAIL = "e2e-plugin-editor@example.com";
const EDITOR_PASSWORD = "another correct horse battery staple";

const SCHEMA = `Table users {
  id int [pk]
  email varchar
}

Table orders {
  id int [pk]
  user_id int [ref: > users.id]
}
`;

const tableNode = (page: Page, name: string) => page.locator(".svelte-flow__node").filter({ hasText: name });
const tableHeader = (page: Page, name: string) => tableNode(page, name).getByText(name, { exact: true });

async function exportedDbml(page: Page, projectId: string): Promise<string> {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/projects/${id}/export/dbml`);
    if (!response.ok) throw new Error(`export: ${response.status}`);
    return response.text();
  }, projectId);
}

/** One table's block of an exported DBML — what "this table is unchanged" is compared on. */
function tableBlock(dbml: string, name: string): string {
  const match = new RegExp(`Table "?${name}"? \\{[^}]*\\}`).exec(dbml);
  assert.ok(match, `no table ${name} in:\n${dbml}`);
  return match[0];
}

/** Waits for something the page shows to become true — never read right after the action that changes it. */
async function settles(check: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  let ok = await check();
  while (!ok && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    ok = await check();
  }
  assert.ok(ok, what);
}

/** Runs a canvas command from the toolbar's plugin palette, found by typing part of its label. */
async function runCanvasCommand(page: Page, search: string, label: string): Promise<void> {
  await page.locator('[data-tooltip="Commandes de plugins"]').click();
  await page.getByPlaceholder("Rechercher une action ou un plugin...").fill(search);
  await page.getByRole("button", { name: label }).click();
}

test(
  "plugins on a locked table: the unlocked tables change, the locked one is put back and the editor is told why",
  { timeout: 120_000 },
  async () => {
    const env = await startE2eEnvironment(PORT);
    try {
      // A wide viewport: at the default size the minimap overlaps the plugin toolbar trigger.
      const viewport = { width: 1600, height: 1000 };
      const admin = await env.browser.newPage({ viewport });
      admin.setDefaultTimeout(15_000);
      await login(admin, env.baseUrl);

      // A project with two related tables, a second account granted `edit` on it, and `users` locked.
      // No helper functions inside `evaluate`: tsx's keepNames wraps them in a
      // `__name(...)` call that doesn't exist in the page.
      const projectId = await admin.evaluate(
        async ({ dbml, email, password }) => {
          const json = { "content-type": "application/json" };
          const created = await fetch("/api/projects", {
            method: "POST",
            headers: json,
            body: JSON.stringify({ name: "Verrous et plugins" }),
          });
          const { id } = (await created.json()) as { id: string };
          const imported = await fetch(`/api/projects/${id}/import`, {
            method: "POST",
            headers: json,
            body: JSON.stringify({ source: dbml }),
          });
          if (!imported.ok) throw new Error(`import failed: ${imported.status}`);

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
          const users = (await (await fetch("/api/users")).json()) as { id: string; email: string }[];
          const editor = users.find((user) => user.email === email);
          if (!editor) throw new Error("editor account not found");
          const team = (await (
            await fetch("/api/teams", { method: "POST", headers: json, body: JSON.stringify({ name: "Éditeurs" }) })
          ).json()) as { id: string };
          await fetch(`/api/teams/${team.id}/members`, {
            method: "POST",
            headers: json,
            body: JSON.stringify({ userId: editor.id }),
          });
          const granted = await fetch(`/api/projects/${id}/teams/${team.id}`, {
            method: "PUT",
            headers: json,
            body: JSON.stringify({ permission: "edit" }),
          });
          if (!granted.ok) throw new Error(`grant failed: ${granted.status}`);

          const content = (await (await fetch(`/api/projects/${id}/content`)).json()) as {
            tables: { id: string; name: string }[];
          };
          const table = content.tables.find((candidate) => candidate.name === "users");
          if (!table) throw new Error("table users not found");
          const locked = await fetch(`/api/projects/${id}/locks/${table.id}`, {
            method: "PUT",
            headers: json,
            body: JSON.stringify({ level: "structure", reason: "Table de référence" }),
          });
          if (!locked.ok) throw new Error(`lock failed: ${locked.status} ${await locked.text()}`);
          return id;
        },
        { dbml: SCHEMA, email: EDITOR_EMAIL, password: EDITOR_PASSWORD },
      );
      const original = await exportedDbml(admin, projectId);
      const lockedUsers = tableBlock(original, "users");
      assert.doesNotMatch(original, /created_at/);

      // The editor, in a separate browser context (its own cookies and its own plugins), with the project open.
      const editorContext = await env.browser.newContext({ viewport });
      const editor = await editorContext.newPage();
      editor.setDefaultTimeout(15_000);
      await editor.goto(env.baseUrl);
      await editor.getByLabel("Adresse e-mail").fill(EDITOR_EMAIL);
      await editor.getByLabel("Mot de passe").fill(EDITOR_PASSWORD);
      await editor.getByRole("button", { name: "Se connecter" }).click();
      await editor.getByText("Verrous et plugins", { exact: true }).waitFor({ timeout: 10_000 });
      await editor.goto(`${env.baseUrl}/project/${projectId}`);
      await tableHeader(editor, "users").waitFor({ timeout: 10_000 });
      // The editor's own picture of the lock is up to date: the padlock is there before any plugin runs.
      await tableNode(editor, "users").getByRole("img", { name: "Table verrouillée" }).waitFor();
      const reverted = editor.getByText("Modification annulée : la table users est verrouillée.");

      // ------------------------------------------------------------------
      // 1. A DBML editor command (built-in plugin) that rewrites every table's block.
      // ------------------------------------------------------------------
      const buffer = () => editor.locator(".cm-content").innerText();
      await editor.locator(".cm-lockedLine").first().waitFor();
      const bufferBefore = await buffer();
      await editor.locator(".cm-line").filter({ hasText: "user_id" }).first().click();
      await editor.keyboard.press("Control+Shift+P");
      await editor.getByPlaceholder("Saisissez une commande…").fill("created_at");
      await editor.getByRole("button", { name: /Insérer created_at\/updated_at dans les tables/ }).click();
      // The plugin's replacement text touches the locked block, so the editor refuses it whole —
      // the unlocked table included — and says which table is in the way…
      await editor.getByText("La table « users » est verrouillée : son bloc ne peut pas être modifié.").waitFor();
      // …while the plugin's own message, written before the refusal, still announces what it meant to do.
      await editor.getByText("Timestamps ajoutés dans 2 table(s).").waitFor();
      assert.equal(await buffer(), bufferBefore, "nothing was written into the buffer");
      assert.equal(await exportedDbml(admin, projectId), original, "nothing reached the server");

      // ------------------------------------------------------------------
      // 2. A built-in canvas command: adds created_at / updated_at to every table.
      // ------------------------------------------------------------------
      await runCanvasCommand(editor, "created_at", "Ajouter created_at & updated_at");
      // The plugin counts what it produced (two columns on each of the two tables), not what was kept.
      await editor.getByText("Timestamps ajoutés (4 champs créés).").waitFor();
      // The locked table is put back by the server, and the editor is told why, without a reload…
      await reverted.waitFor();
      // …while the unlocked table keeps its new columns. Read in the editor's own DBML panel, drawn
      // from the same live document as the canvas (whose nodes only list the key columns here).
      await settles(async () => {
        const text = await buffer();
        return /created_at/.test(tableBlock(text, "orders")) && !/created_at/.test(tableBlock(text, "users"));
      }, "the editor's schema has the new columns on orders only");
      assert.match(tableBlock(await buffer(), "orders"), /updated_at/);
      assert.doesNotMatch(tableBlock(await buffer(), "users"), /updated_at/);
      assert.match(tableBlock(await buffer(), "users"), /email/);
      await tableNode(editor, "users").getByRole("img", { name: "Table verrouillée" }).waitFor();

      const afterTimestamps = await exportedDbml(admin, projectId);
      assert.equal(tableBlock(afterTimestamps, "users"), lockedUsers, "the locked table is exactly as it was");
      assert.match(tableBlock(afterTimestamps, "orders"), /created_at/);
      assert.match(tableBlock(afterTimestamps, "orders"), /updated_at/);
      await reverted.waitFor({ state: "detached", timeout: 20_000 });

      // ------------------------------------------------------------------
      // 3. A plugin the editor installs, running in the sandboxed Worker: prefixes every table name.
      // ------------------------------------------------------------------
      await editor.locator('[data-tooltip="Commandes de plugins"]').click();
      await editor.getByText("Gestionnaire de plugins…", { exact: true }).click();
      await editor.getByRole("button", { name: "Studio & Créateur" }).click();
      await editor
        .locator("select")
        .filter({ has: editor.locator('option[value="boilerplate-canvas-command"]') })
        .selectOption("boilerplate-canvas-command");
      await editor.waitForFunction(() =>
        [...document.querySelectorAll("textarea")].some((area) => area.value.includes('id: "prefix-tables"')),
      );
      await editor.getByRole("button", { name: "Enregistrer & Installer" }).click();
      // Installed means the Worker loaded the source and answered with its contributions.
      await editor.getByText("Mon Outil Canvas", { exact: true }).waitFor();
      await editor.keyboard.press("Escape");

      await runCanvasCommand(editor, "tbl_", "Ajouter le préfixe tbl_ aux tables");
      await editor.getByText("Préfixe tbl_ ajouté avec succès !").waitFor();
      await tableHeader(editor, "tbl_orders").waitFor();
      await reverted.waitFor();
      await tableNode(editor, "tbl_users").waitFor({ state: "detached" });
      await tableHeader(editor, "users").waitFor();
      await tableNode(editor, "users").getByRole("img", { name: "Table verrouillée" }).waitFor();

      const afterPrefix = await exportedDbml(admin, projectId);
      assert.equal(tableBlock(afterPrefix, "users"), lockedUsers, "the locked table kept its name and its columns");
      assert.match(afterPrefix, /Table "?tbl_orders"? \{/);
      assert.doesNotMatch(afterPrefix, /tbl_users/);
      // The relation follows the renamed table and still points at the locked one.
      assert.match(afterPrefix, /tbl_orders"?\."?user_id"? > "?users"?\."?id/);
      await reverted.waitFor({ state: "detached", timeout: 20_000 });

      // ------------------------------------------------------------------
      // 4. An importer: refused whole by the server, and the dialog says so.
      // ------------------------------------------------------------------
      await editor.getByRole("button", { name: "Importer", exact: true }).click();
      const importDialog = editor.getByRole("dialog", { name: "Importer un schéma" });
      await importDialog
        .locator("textarea")
        .fill(
          [
            "Table users {",
            "  id int [pk]",
            "  email varchar",
            "  phone varchar",
            "}",
            "",
            "Table tbl_orders {",
            "  id int [pk]",
            "  user_id int [ref: > users.id]",
            "}",
            "",
            "Table audit {",
            "  id int [pk]",
            "}",
            "",
          ].join("\n"),
        );
      await importDialog.getByRole("button", { name: "Importer", exact: true }).click();
      await importDialog
        .getByText("Modification refusée : table verrouillée (users). Rien n'a été appliqué.")
        .waitFor();
      // Nothing at all, unlike a canvas command: not the new table, not the columns the source leaves out.
      assert.equal(await exportedDbml(admin, projectId), afterPrefix);
      assert.equal(await tableNode(editor, "audit").count(), 0);
      await editor.keyboard.press("Escape");
      await importDialog.waitFor({ state: "detached" });

      // ------------------------------------------------------------------
      // 5. The same built-in command, run by the administrator the lock does not bind.
      // ------------------------------------------------------------------
      await admin.goto(`${env.baseUrl}/project/${projectId}`);
      await tableHeader(admin, "users").waitFor({ timeout: 10_000 });
      await runCanvasCommand(admin, "created_at", "Ajouter created_at & updated_at");
      // `tbl_orders` already has both columns: only the locked table was missing them.
      await admin.getByText("Timestamps ajoutés (2 champs créés).").waitFor();
      // It reaches the editor's schema too: the lock is about who changes the table, not about plugins.
      await settles(
        async () => /created_at[^}]*updated_at/.test(tableBlock(await buffer(), "users")),
        "the editor sees the administrator's columns on the locked table",
      );
      assert.equal(await admin.getByText(/Modification annulée/).count(), 0);
      const afterAdmin = await exportedDbml(admin, projectId);
      assert.match(tableBlock(afterAdmin, "users"), /created_at/);
      assert.match(tableBlock(afterAdmin, "users"), /updated_at/);
    } finally {
      await env.teardown();
    }
  },
);
