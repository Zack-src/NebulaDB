import { test } from "node:test";
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * The two controls of the Webhooks dialog that `webhooks.e2e.ts` never
 * touches: the event checkboxes of the "add" form, and the "Actif" switch of
 * an existing webhook.
 *
 * What only a browser can show: both are the app's own drawn controls (a
 * visually hidden `<input>` behind a drawn box, a `<button role="switch">`
 * inside a `<label>`), so a click on what the user sees has to reach the
 * state the request is built from — and the switch has to take effect at
 * once, with the "Désactivé" badge following the server's answer. What the
 * server does with `events` and `enabled` (which deliveries go out) is
 * covered in `modules/webhooks/routes.test.ts`.
 */

const PORT = Number(process.env.E2E_PORT) || 4427;
// Never called: nothing in this test sends a delivery.
const HOOK_URL = "http://127.0.0.1:9/hook";

interface SavedWebhook {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
}

/** The project's webhooks as the server has them — the only proof a click was saved. */
async function savedWebhooks(page: Page, projectId: string): Promise<SavedWebhook[]> {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/projects/${id}/webhooks`);
    if (!response.ok) throw new Error(`webhooks: ${response.status}`);
    return (await response.json()) as SavedWebhook[];
  }, projectId);
}

test(
  "webhooks: an unticked event is not subscribed, and the switch disables then re-enables the webhook",
  { timeout: 60_000 },
  async () => {
    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage();
      page.setDefaultTimeout(15_000);
      await login(page, env.baseUrl);
      const projectId = await page.evaluate(async () => {
        const created = await fetch("/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Options" }),
        });
        return ((await created.json()) as { id: string }).id;
      });
      await page.reload();

      await page.getByRole("button", { name: "Webhooks", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Webhooks — Options" });
      await dialog.getByText("Aucun webhook pour ce projet.").waitFor();

      // --- The event checkboxes: all ticked to begin with, one unticked before adding ---
      const schemaChanges = dialog.getByRole("checkbox", { name: "Modifications du schéma" });
      const deployments = dialog.getByRole("checkbox", { name: "Déploiements" });
      const drift = dialog.getByRole("checkbox", { name: "Modifications hors Nebula" });
      assert.equal(await schemaChanges.isChecked(), true);
      assert.equal(await deployments.isChecked(), true);
      assert.equal(await drift.isChecked(), true);

      // The input is visually hidden: the click goes on the text, as a user's would.
      await dialog.getByText("Déploiements", { exact: true }).click();
      await page.waitForFunction(() => {
        const boxes = [...document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')];
        return boxes.length === 3 && boxes.filter((box) => box.checked).length === 2;
      });
      assert.equal(await deployments.isChecked(), false);
      assert.equal(await schemaChanges.isChecked(), true, "the neighbours are untouched");
      assert.equal(await drift.isChecked(), true, "the neighbours are untouched");

      await dialog.getByLabel("Adresse du webhook").fill(HOOK_URL);
      await dialog.getByRole("combobox", { name: "Format" }).click();
      await page.getByRole("option", { name: "JSON signé" }).click();
      await dialog.getByRole("button", { name: "Ajouter" }).click();
      await dialog.getByTestId("webhook-secret").waitFor();
      await dialog.getByText("127.0.0.1:9/hook", { exact: true }).waitFor();

      const created = await savedWebhooks(page, projectId);
      assert.equal(created.length, 1);
      assert.equal(created[0].url, HOOK_URL);
      assert.deepEqual([...created[0].events].sort(), ["drift.detected", "schema.changed"]);
      assert.equal(created[0].enabled, true);
      // The form keeps the choice for the next webhook rather than silently ticking the box again.
      assert.equal(await deployments.isChecked(), false);

      // --- The "Actif" switch: off, at once ---
      const active = dialog.getByRole("switch", { name: "Actif" });
      const disabledBadge = dialog.getByText("Désactivé", { exact: true });
      assert.equal(await active.getAttribute("aria-checked"), "true");
      assert.equal(await disabledBadge.count(), 0);

      await active.click();
      await disabledBadge.waitFor();
      await page.waitForFunction(
        () => document.querySelector('[role="dialog"] [role="switch"]')?.getAttribute("aria-checked") === "false",
      );
      const disabled = await savedWebhooks(page, projectId);
      assert.equal(disabled[0].enabled, false);
      assert.deepEqual([...disabled[0].events].sort(), ["drift.detected", "schema.changed"], "its events are kept");

      // Closed and reopened: the dialog shows what was saved, not what was clicked.
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Webhooks", exact: true }).click();
      await disabledBadge.waitFor();
      assert.equal(await active.getAttribute("aria-checked"), "false");

      // --- And back on ---
      await active.click();
      await disabledBadge.waitFor({ state: "detached" });
      await page.waitForFunction(
        () => document.querySelector('[role="dialog"] [role="switch"]')?.getAttribute("aria-checked") === "true",
      );
      const enabled = await savedWebhooks(page, projectId);
      assert.equal(enabled.length, 1);
      assert.equal(enabled[0].id, created[0].id, "the same webhook, not a new one");
      assert.equal(enabled[0].enabled, true);
    } finally {
      await env.teardown();
    }
  },
);
