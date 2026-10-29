import assert from "node:assert/strict";
import { test } from "node:test";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * The workspace tour: offered the first time a browser opens a project, with
 * something to point at on every step, never in the way of the editor, not
 * shown again once started — and replayable from the project header.
 */

const PORT = Number(process.env.E2E_PORT) || 4423;

test("onboarding: the tour runs once on a first visit and can be replayed", { timeout: 90_000 }, async () => {
  const env = await startE2eEnvironment(PORT);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
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
    // Only on the first load of the tab: the init script runs again on a reload, which must keep the flag.
    await page.addInitScript(() => {
      if (sessionStorage.getItem("tour-test-cleared")) return;
      sessionStorage.setItem("tour-test-cleared", "1");
      localStorage.removeItem("nebuladb.tour.workspace.seen");
    });
    await page.goto(`${env.baseUrl}/project/${projectId}`);

    const tour = page.getByTestId("tour");
    await tour.getByRole("heading", { name: "Schéma" }).waitFor();
    const progress = (await tour.getByText(/Visite guidée · 1 \/ \d+/).innerText()).match(/\/ (\d+)/);
    const total = Number(progress?.[1]);
    assert.ok(total >= 4, "the schema, history, dictionary and problems tabs, plus the palette, at least");
    await page.getByTestId("tour-highlight").waitFor();

    // It points at things and does not stop the editor from being used underneath.
    await page.locator(".svelte-flow__node").filter({ hasText: "customers" }).waitFor();

    for (let step = 1; step < total; step++) {
      await tour.getByRole("button", { name: "Suivant" }).click();
      await tour.getByText(`Visite guidée · ${step + 1} / ${total}`).waitFor();
    }
    await tour.getByRole("heading", { name: "Palette globale" }).waitFor();
    await tour.getByRole("button", { name: "Terminer" }).click();
    await tour.waitFor({ state: "detached" });

    // Not shown again after a reload.
    await page.reload();
    await page.locator(".svelte-flow__node").filter({ hasText: "customers" }).waitFor();
    assert.equal(await page.getByTestId("tour").count(), 0, "the tour must not come back after the first visit");

    // Replay from the header, and Escape ends it.
    await page.getByTestId("replay-tour").click();
    await tour.getByText(`Visite guidée · 1 / ${total}`).waitFor();
    await page.keyboard.press("Escape");
    await tour.waitFor({ state: "detached" });
    assert.deepEqual(errors, []);
  } finally {
    await env.teardown();
  }
});
