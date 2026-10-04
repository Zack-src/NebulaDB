import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * The editor's guided tour: offered the first time a browser opens a project,
 * step by step with something to point at, never in the way of the editor,
 * not shown again once finished — and replayable from the header.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each step.
 */

const PORT = Number(process.env.E2E_PORT) || 4423;

test("onboarding: the tour runs once on a first visit and can be replayed", { timeout: 90_000 }, async () => {
  const env = await startE2eEnvironment(PORT);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    const snap = async (name: string) => {
      if (process.env.E2E_SHOTS) await page.screenshot({ path: join(process.env.E2E_SHOTS, `tour-${name}.png`) });
    };
    await login(page, env.baseUrl);

    const projectId = await page.evaluate(async () => {
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
      return id;
    });

    // `login` marks the tour as seen for every other test; this one is the first visit.
    await page.addInitScript(() => localStorage.removeItem("athanordb.tour.editor.seen"));
    await page.goto(`${env.baseUrl}/project/${projectId}`);

    const tour = page.getByTestId("tour");
    const highlight = page.getByTestId("tour-highlight");
    await tour.getByRole("heading", { name: "Le diagramme" }).waitFor();
    await tour.getByText("Visite guidée · 1 / 5").waitFor();
    await highlight.waitFor();
    await snap("1-canvas");

    // It points at things, and does not stop the editor from being used underneath.
    const table = page.locator(".svelte-flow__node").filter({ hasText: "customers" });
    await table.waitFor();
    assert.equal(await page.getByRole("dialog").count(), 1, "a card, not a modal stack");

    const next = tour.getByRole("button", { name: "Suivant" });
    await next.click();
    await tour.getByRole("heading", { name: "Le même schéma, en texte" }).waitFor();
    // The highlight has moved onto the DBML panel, on the left.
    await page.waitForFunction(() => {
      const box = document.querySelector('[data-testid="tour-highlight"]')?.getBoundingClientRect();
      return box !== undefined && box.left < 100 && box.width < 700;
    });
    await snap("2-dbml");
    await next.click();
    await tour.getByRole("heading", { name: "Affichage et outils" }).waitFor();
    await snap("3-toolbar");
    await next.click();
    await tour.getByRole("heading", { name: "Quelques raccourcis" }).waitFor();
    await tour.getByText("Ctrl+D").waitFor();
    await snap("4-shortcuts");
    await tour.getByRole("button", { name: "Précédent" }).click();
    await tour.getByRole("heading", { name: "Affichage et outils" }).waitFor();
    await next.click();
    await next.click();
    await tour.getByRole("heading", { name: "Le reste du projet" }).waitFor();
    assert.equal(await next.count(), 0);
    await snap("5-workspace");
    await tour.getByRole("button", { name: "Terminer" }).click();
    await tour.waitFor({ state: "detached" });
    await highlight.waitFor({ state: "detached" });

    // Seen: a reload does not bring it back. (The init script above would undo that; check the stored flag instead.)
    assert.equal(await page.evaluate(() => localStorage.getItem("athanordb.tour.editor.seen")), "true");

    // Replayed on request, and Escape or "Passer" leaves it.
    await page.getByRole("button", { name: "Visite guidée" }).click();
    await tour.getByRole("heading", { name: "Le diagramme" }).waitFor();
    await page.keyboard.press("Escape");
    await tour.waitFor({ state: "detached" });

    assert.deepEqual(errors, []);
  } finally {
    await env.teardown();
  }
});
