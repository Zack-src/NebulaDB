import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * The pipeline card: the project's databases along the stages, a guarded
 * stage that waits for the one before it, the deployment refused out of
 * order, and the instance administrator's way past it — with a reason.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each step.
 */

const PORT = Number(process.env.E2E_PORT) || 4422;

test("pipeline: stages in order, a refused skip, then a skip with a reason", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "nebuladb-e2e-pipeline-"));
  const env = await startE2eEnvironment(PORT);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    const snap = async (name: string) => {
      if (process.env.E2E_SHOTS) await page.screenshot({ path: join(process.env.E2E_SHOTS, `pipeline-${name}.png`) });
    };
    await login(page, env.baseUrl);

    const projectId = await page.evaluate(
      async ({ dir }) => {
        const json = { "content-type": "application/json" };
        const chain = (await (await fetch("/api/environments")).json()) as {
          environments: { id: string; name: string }[];
        };
        for (const [name, protection] of [
          ["DEV", "free"],
          ["Staging", "review"],
        ]) {
          const stage = chain.environments.find((entry) => entry.name === name);
          await fetch(`/api/admin/environments/${stage?.id}`, {
            method: "PATCH",
            headers: json,
            body: JSON.stringify({ protection }),
          });
        }
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
        for (const [name, environment] of [
          ["Base dev", "DEV"],
          ["Base staging", "Staging"],
        ]) {
          await fetch(`/api/projects/${id}/connections`, {
            method: "POST",
            headers: json,
            body: JSON.stringify({ name, engine: "sqlite", filePath: `${dir}/${environment}.sqlite`, environment }),
          });
        }
        return id;
      },
      { dir: dir.replace(/\\/g, "/") },
    );

    await page.goto(`${env.baseUrl}/project/${projectId}/deployments`);
    const card = page.getByTestId("pipeline");
    const stage = (name: string) => card.locator(`[data-stage="${name}"]`);
    const stateOf = (name: string) => stage(name).locator("[data-connection]").getAttribute("data-state");
    await stage("Staging").getByText("Attend DEV").waitFor();
    assert.equal(await stateOf("DEV"), "never");
    assert.equal(await stage("DEV").getByText("Attend").count(), 0);
    await snap("start");

    /** Selects the inline deployment panel from a stage of the card and applies the plan. */
    const deployFrom = async (name: string, notice?: RegExp) => {
      await stage(name).getByRole("button", { name: "Déployer" }).click();
      const modal = page.getByTestId("deployment-panel");
      // The plan says what would refuse the deployment, before "Apply".
      if (notice) await modal.getByRole("alert").filter({ hasText: notice }).waitFor();
      await modal.getByRole("button", { name: "Prévisualiser le SQL" }).click();
      await modal.getByRole("button", { name: "Appliquer les modifications en base" }).click();
      return modal;
    };
    const close = async (_modal: ReturnType<Page["getByRole"]>) => {
      assert.equal(await page.getByRole("dialog").count(), 0);
    };

    // Out of order: refused, in words.
    let modal = await deployFrom("Staging", /Cette étape attend DEV/);
    await modal.getByText("Cette étape ne reçoit un schéma qu'une fois l'étape précédente à niveau").waitFor();
    await snap("refused");
    await close(modal);

    // In order: DEV, which opens Staging.
    modal = await deployFrom("DEV");
    await modal.getByText("Cette étape ne reçoit").waitFor({ state: "detached" });
    await close(modal);
    await page.waitForFunction(
      () => document.querySelector('[data-stage="DEV"] [data-connection]')?.getAttribute("data-state") === "level",
    );
    await stage("Staging").getByText("Attend DEV").waitFor({ state: "detached" });
    modal = await deployFrom("Staging");
    await close(modal);
    await page.waitForFunction(
      () => document.querySelector('[data-stage="Staging"] [data-connection]')?.getAttribute("data-state") === "level",
    );
    await snap("level");

    // The schema moves on; the urgent fix goes straight to Staging, with its reason.
    await page.evaluate(async (id) => {
      await fetch(`/api/projects/${id}/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "Table customers {\n  id integer [pk]\n  email varchar(320)\n}\n" }),
      });
    }, projectId);
    // The card follows the schema by itself: no "Actualiser".
    await stage("Staging").getByText("Attend DEV").waitFor();
    assert.equal(await stateOf("Staging"), "behind");

    modal = await deployFrom("Staging");
    const skip = modal.getByTestId("stage-skip");
    const go = skip.getByRole("button", { name: "Sauter l'étape et déployer" });
    await go.waitFor();
    assert.equal(await go.isDisabled(), true, "no skip without a reason");
    await skip.getByLabel("Motif pour sauter l'étape").fill("Correctif urgent : connexion impossible");
    await go.click();
    await skip.waitFor({ state: "detached" });
    await close(modal);
    await page.waitForFunction(
      () => document.querySelector('[data-stage="Staging"] [data-connection]')?.getAttribute("data-state") === "level",
    );
    assert.equal(await stateOf("DEV"), "behind");

    const skips = await page.evaluate(async () => {
      const res = await fetch("/api/admin/activity?search=Correctif");
      return ((await res.json()) as { entries: { action: string; detail: string }[] }).entries;
    });
    assert.deepEqual(
      skips.map((entry) => [entry.action, entry.detail]),
      [["connection.deploy.stage_skipped", "Correctif urgent : connexion impossible"]],
    );

    assert.deepEqual(errors, []);
  } finally {
    await env.teardown();
  }
});
