import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Mentions in comments, with two accounts: typing `@` offers the people who
 * can see the project (and not the one who cannot), the mention is shown set
 * off, the mentioned account is told at once in its bell — without following
 * the project — and a reply in that thread tells the first author.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each step.
 */

const PORT = Number(process.env.E2E_PORT) || 4429;
const PASSWORD = "correct horse battery staple colleague";
const COLLEAGUE_EMAIL = "e2e-colleague@example.com";
const OUTSIDER_EMAIL = "e2e-colleague-outsider@example.com";

test(
  "comment mentions: offered to those who see the project, notified at once, a reply answers back",
  {
    timeout: 120_000,
  },
  async () => {
    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
      page.setDefaultTimeout(15_000);
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(String(err)));
      const snap = async (name: string) => {
        if (process.env.E2E_SHOTS) await page.screenshot({ path: join(process.env.E2E_SHOTS, `mentions-${name}.png`) });
      };
      await login(page, env.baseUrl);

      // A project; a colleague who may edit it; and a third account who may not even see it.
      const projectId = await page.evaluate(
        async ({ colleague, outsider, password }) => {
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
            body: JSON.stringify({ source: "Table customers {\n  id integer [pk]\n  email varchar\n}\n" }),
          });
          for (const email of [colleague, outsider]) {
            const invited = await fetch("/api/invitations", {
              method: "POST",
              headers: json,
              body: JSON.stringify({ email }),
            });
            const { token } = (await invited.json()) as { token: string };
            await fetch(`/api/invitations/${token}/accept`, {
              method: "POST",
              headers: json,
              body: JSON.stringify({ password }),
            });
          }
          const users = (await (await fetch("/api/users")).json()) as { id: string; email: string }[];
          const team = (await (
            await fetch("/api/teams", { method: "POST", headers: json, body: JSON.stringify({ name: "Boutique" }) })
          ).json()) as { id: string };
          await fetch(`/api/teams/${team.id}/members`, {
            method: "POST",
            headers: json,
            body: JSON.stringify({ userId: users.find((user) => user.email === colleague)?.id }),
          });
          await fetch(`/api/projects/${id}/teams/${team.id}`, {
            method: "PUT",
            headers: json,
            body: JSON.stringify({ permission: "edit" }),
          });
          return id;
        },
        { colleague: COLLEAGUE_EMAIL, outsider: OUTSIDER_EMAIL, password: PASSWORD },
      );

      // The colleague, in their own browser profile, with the project open.
      const colleagueContext = await env.browser.newContext({ viewport: { width: 1400, height: 900 } });
      const signedIn = await colleagueContext.request.post(`${env.baseUrl}/api/auth/login`, {
        headers: { origin: env.baseUrl },
        data: { email: COLLEAGUE_EMAIL, password: PASSWORD },
      });
      assert.equal(signedIn.status(), 200);
      const colleaguePage = await colleagueContext.newPage();
      colleaguePage.setDefaultTimeout(15_000);
      colleaguePage.on("pageerror", (err) => errors.push(String(err)));
      await colleaguePage.goto(`${env.baseUrl}/project/${projectId}`);
      await colleaguePage.locator(".svelte-flow__node").filter({ hasText: "customers" }).waitFor();

      // The admin opens the table's comments and types an @.
      await page.goto(`${env.baseUrl}/project/${projectId}`);
      const node = page.locator(".svelte-flow__node").filter({ hasText: "customers" });
      await node.waitFor();
      await node.getByRole("button", { name: "Commentaires de la table" }).click();
      const box = page.getByPlaceholder("Ajouter un commentaire");
      await box.click();
      await box.pressSequentially("Peux-tu relire ça @e2e-");
      const list = page.getByTestId("mention-list");
      await list.waitFor();
      // The colleague is offered; the account that cannot see the project is not, nor is the author.
      await list.getByRole("option", { name: "e2e-colleague", exact: true }).waitFor();
      assert.equal(await list.getByRole("option").count(), 1);
      await snap("list");

      // Keyboard: Enter picks the highlighted person and the list closes.
      await box.press("Enter");
      await list.waitFor({ state: "detached" });
      assert.equal(await box.inputValue(), "Peux-tu relire ça @e2e-colleague ");
      await box.pressSequentially("?");
      await page.getByRole("button", { name: "Publier" }).click();

      // The comment shows the mention set off, not as raw text.
      const mention = page.locator("[data-mention]");
      await mention.waitFor();
      assert.equal(await mention.textContent(), "@e2e-colleague");
      assert.ok(!(await page.locator("body").textContent())?.includes("]("));
      await snap("posted");

      // The colleague does not follow the project, and is told all the same — with no reload.
      await colleaguePage.getByTestId("notification-count").waitFor({ timeout: 5_000 });
      await colleaguePage.getByRole("button", { name: "Notifications : 1 non lue", exact: true }).click();
      const entry = colleaguePage
        .getByRole("dialog", { name: "Notifications" })
        .getByRole("listitem")
        .filter({ hasText: "e2e-admin vous a mentionné sur la table « customers »" });
      await entry.waitFor();
      // A pointer, never the comment itself.
      assert.ok(!(await entry.textContent())?.includes("relire"));
      await colleaguePage.keyboard.press("Escape");

      // The colleague answers in the same thread: the mention is set off for them too.
      await colleaguePage
        .locator(".svelte-flow__node")
        .filter({ hasText: "customers" })
        .getByRole("button", { name: "Commentaires de la table" })
        .click();
      await colleaguePage.locator("[data-mention]").waitFor();
      await colleaguePage.getByPlaceholder("Ajouter un commentaire").fill("Oui, je regarde.");
      await colleaguePage.getByRole("button", { name: "Publier" }).click();

      // The admin, who has the project open, is told of the reply at once.
      await page.getByTestId("notification-count").waitFor({ timeout: 5_000 });
      await page.getByRole("button", { name: "Notifications : 1 non lue", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Notifications" })
        .getByRole("listitem")
        .filter({ hasText: "e2e-colleague a répondu dans un fil où vous avez écrit, sur la table « customers »" })
        .waitFor();
      await snap("reply");

      assert.deepEqual(errors, []);
    } finally {
      await env.teardown();
    }
  },
);
