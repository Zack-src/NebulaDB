import assert from "node:assert/strict";
import { test } from "node:test";
import type { Page } from "playwright-core";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Table locks, end to end, with two people in the same project: an
 * administrator who places and lifts the lock, and an editor who has the
 * project open the whole time.
 *
 * What only a browser can show: the padlock reaches the editor's canvas
 * without a reload (the server announces it over the project's socket), the
 * editor's node stops *offering* structural edits while still moving and
 * commenting, and a keyboard delete leaves the table in place and says why.
 * That the server refuses the change regardless of what the UI offers is
 * covered where it is enforced: `realtime/room.test.ts` and
 * `modules/tableLocks/routes.test.ts`.
 */

const PORT = Number(process.env.E2E_PORT) || 4403;
const EDITOR_EMAIL = "e2e-editor@example.com";
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
const addColumn = (page: Page, name: string) =>
  tableNode(page, name).getByRole("button", { name: "Ajouter une colonne" });

test(
  "an administrator locks a table; the editor sees it live and can no longer alter it",
  { timeout: 90_000 },
  async () => {
    const env = await startE2eEnvironment(PORT);
    try {
      const admin = await env.browser.newPage();
      await login(admin, env.baseUrl);

      // A project with two related tables, and a second account granted `edit` on it through a team.
      // No helper functions inside `evaluate`: tsx's keepNames wraps them in a
      // `__name(...)` call that doesn't exist in the page.
      const projectId = await admin.evaluate(
        async ({ dbml, email, password }) => {
          const json = { "content-type": "application/json" };
          const created = await fetch("/api/projects", {
            method: "POST",
            headers: json,
            body: JSON.stringify({ name: "Verrous" }),
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
          return id;
        },
        { dbml: SCHEMA, email: EDITOR_EMAIL, password: EDITOR_PASSWORD },
      );

      // The editor, in a separate browser context (its own cookies), with the project open.
      const editorContext = await env.browser.newContext();
      const editor = await editorContext.newPage();
      await editor.goto(env.baseUrl);
      await editor.getByLabel("Adresse e-mail").fill(EDITOR_EMAIL);
      await editor.getByLabel("Mot de passe").fill(EDITOR_PASSWORD);
      await editor.getByRole("button", { name: "Se connecter" }).click();
      await editor.getByText("Verrous", { exact: true }).waitFor({ timeout: 10_000 });
      await editor.goto(`${env.baseUrl}/project/${projectId}`);
      await tableHeader(editor, "users").waitFor({ timeout: 10_000 });
      await addColumn(editor, "users").waitFor();
      // An editor is not offered the lock button at all.
      assert.equal(await editor.getByRole("button", { name: "Verrouiller la table…" }).count(), 0);

      // --- The administrator locks `users` ---
      await admin.goto(`${env.baseUrl}/project/${projectId}`);
      await tableHeader(admin, "users").waitFor({ timeout: 10_000 });
      await tableNode(admin, "users").hover();
      await tableNode(admin, "users").getByRole("button", { name: "Verrouiller la table…" }).click();
      const dialog = admin.getByRole("dialog", { name: "Verrou de la table « users »" });
      await dialog.getByRole("radio", { name: /Structure/ }).waitFor();
      await dialog.getByLabel("Motif (visible par tous)").fill("Table de référence RH");
      await dialog.getByRole("button", { name: "Verrouiller", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
      await admin.getByText("Table « users » verrouillée.").waitFor();
      await tableNode(admin, "users")
        .getByRole("button", { name: "Table verrouillée — modifier le verrou…" })
        .waitFor();
      // Still editable for the administrator who placed it.
      assert.equal(await addColumn(admin, "users").count(), 1);

      // --- The editor sees it without reloading ---
      const padlock = tableNode(editor, "users").getByRole("img", { name: "Table verrouillée" });
      await padlock.waitFor({ timeout: 10_000 });
      assert.match((await padlock.getAttribute("data-tooltip-note")) ?? "", /Table de référence RH/);
      await addColumn(editor, "users").waitFor({ state: "detached" });
      assert.equal(await addColumn(editor, "orders").count(), 1, "the unlocked table is unaffected");

      // Double-click no longer opens the rename field…
      await tableHeader(editor, "users").dblclick();
      assert.equal(await tableNode(editor, "users").locator("input").count(), 0);
      // …and Delete leaves the table where it is, with an explanation.
      await tableHeader(editor, "users").click();
      await editor.keyboard.press("Delete");
      await editor.getByText(/Table conservée : users/).waitFor();
      assert.equal(await tableNode(editor, "users").count(), 1);
      assert.equal(await tableNode(admin, "users").count(), 1);

      // --- Lifting the lock gives the editor the table back, again without a reload ---
      await tableNode(admin, "users").getByRole("button", { name: "Table verrouillée — modifier le verrou…" }).click();
      await admin.getByRole("dialog").getByRole("button", { name: "Déverrouiller" }).click();
      await admin.getByText("Table « users » déverrouillée.").waitFor();
      await addColumn(editor, "users").waitFor({ timeout: 10_000 });
      assert.equal(await tableNode(editor, "users").getByRole("img", { name: "Table verrouillée" }).count(), 0);
    } finally {
      await env.teardown();
    }
  },
);
