import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Following a project: the eye in the project header picks the events, a
 * colleague's action shows up in the bell with its unread count, and opening
 * the notification marks it read.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each step.
 */

const PORT = Number(process.env.E2E_PORT) || 4424;
const COLLEAGUE_EMAIL = "e2e-colleague@example.com";
const COLLEAGUE_PASSWORD = "correct horse battery staple colleague";

test("notifications: follow a project, be told what a colleague did, read it", { timeout: 90_000 }, async () => {
  const env = await startE2eEnvironment(PORT);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    const snap = async (name: string) => {
      if (process.env.E2E_SHOTS)
        await page.screenshot({ path: join(process.env.E2E_SHOTS, `notifications-${name}.png`) });
    };
    await login(page, env.baseUrl);

    // A project, and a colleague who administers it too.
    const { projectId, tableId } = await page.evaluate(
      async ({ email, password }) => {
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
          body: JSON.stringify({ source: "Table customers {\n  id integer [pk]\n}\n" }),
        });
        const content = (await (await fetch(`/api/projects/${id}/content`)).json()) as { tables: { id: string }[] };
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
        const users = (await (await fetch("/api/users")).json()) as { id: string; email: string }[];
        const colleague = users.find((user) => user.email === email);
        const team = (await (
          await fetch("/api/teams", {
            method: "POST",
            headers: json,
            body: JSON.stringify({ name: "Admins boutique" }),
          })
        ).json()) as { id: string };
        await fetch(`/api/teams/${team.id}/members`, {
          method: "POST",
          headers: json,
          body: JSON.stringify({ userId: colleague?.id }),
        });
        await fetch(`/api/projects/${id}/teams/${team.id}`, {
          method: "PUT",
          headers: json,
          body: JSON.stringify({ permission: "administrator" }),
        });
        return { projectId: id, tableId: content.tables[0].id };
      },
      { email: COLLEAGUE_EMAIL, password: COLLEAGUE_PASSWORD },
    );

    // Follow the project's locks, from its header.
    await page.goto(`${env.baseUrl}/project/${projectId}`);
    // The table on the canvas came through the project's socket: it is open, and what the server pushes will arrive.
    await page.locator(".svelte-flow__node").filter({ hasText: "customers" }).waitFor();
    await page.getByRole("button", { name: "Suivre ce projet" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Verrous posés ou levés" }).click();
    await page.getByRole("button", { name: "Vous suivez 1 type d'événement de ce projet" }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByTestId("notification-count").count(), 0);

    // The colleague, signed in elsewhere, locks the table.
    const colleague = await env.browser.newContext();
    const origin = { origin: env.baseUrl };
    const signedIn = await colleague.request.post(`${env.baseUrl}/api/auth/login`, {
      headers: origin,
      data: { email: COLLEAGUE_EMAIL, password: COLLEAGUE_PASSWORD },
    });
    assert.equal(signedIn.status(), 200);
    const locked = await colleague.request.put(`${env.baseUrl}/api/projects/${projectId}/locks/${tableId}`, {
      headers: origin,
      data: { level: "structure", reason: "référence" },
    });
    assert.equal(locked.status(), 200, await locked.text());

    // The open project is told at once: the count appears with no reload, no
    // click, and long before the bell's one-minute poll would have found it.
    await page.getByTestId("notification-count").waitFor({ timeout: 5_000 });
    const unreadBell = page.getByRole("button", { name: "Notifications : 1 non lue", exact: true });
    await unreadBell.waitFor();

    await unreadBell.click();
    const centre = page.getByRole("dialog", { name: "Notifications" });
    const entry = centre.getByRole("listitem").filter({ hasText: "a verrouillé la table « customers »" });
    await entry.waitFor();
    assert.equal(await entry.getAttribute("data-read"), "false");
    assert.equal(
      await page
        .getByTestId("notification-count")
        .textContent()
        .then((text) => text?.trim()),
      "1",
    );
    await snap("unread");

    // Opening it marks it read; it is still there on the dashboard, read.
    await entry.getByRole("button").click();
    await page.getByTestId("notification-count").waitFor({ state: "detached" });
    await page.goto(env.baseUrl);
    await page.getByRole("button", { name: "Notifications", exact: true }).click();
    const again = page.getByRole("dialog", { name: "Notifications" }).getByRole("listitem");
    await again.first().waitFor();
    assert.equal(await again.first().getAttribute("data-read"), "true");
    await again.first().getByText("Boutique").waitFor();

    // One's own doing is not news: unlocking it oneself adds nothing.
    await page.evaluate(
      async ({ id, table }) => {
        await fetch(`/api/projects/${id}/locks/${table}`, { method: "DELETE" });
      },
      { id: projectId, table: tableId },
    );
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Notifications", exact: true }).click();
    await again.first().waitFor();
    assert.equal(await again.count(), 1);

    assert.deepEqual(errors, []);
  } finally {
    await env.teardown();
  }
});
