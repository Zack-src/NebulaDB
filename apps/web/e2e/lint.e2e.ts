import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * The problems tab: the linter's findings table by table, the two safe fixes
 * applied to the live document, the rules changed by an administrator and
 * kept across a reload, and a finding opened in the schema.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each step.
 */

const PORT = Number(process.env.E2E_PORT) || 4417;

const SOURCE = `Table customers {
  id integer [pk]
  name varchar
}

Table OrderLines {
  customer_id integer [ref: > customers.id]
  label text
}
`;

test("lint: findings are listed, fixed, excepted and ruled by the project's profile", { timeout: 90_000 }, async () => {
  const env = await startE2eEnvironment(PORT);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    let shot = 0;
    const snap = async (name: string) => {
      if (process.env.E2E_SHOTS)
        await page.screenshot({ path: join(process.env.E2E_SHOTS, `lint-${++shot}-${name}.png`) });
    };
    await login(page, env.baseUrl);

    const projectId = await page.evaluate(async (source) => {
      const json = { "content-type": "application/json" };
      const created = await fetch("/api/projects", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ name: "Boutique" }),
      });
      const { id } = (await created.json()) as { id: string };
      await fetch(`/api/projects/${id}/import`, { method: "POST", headers: json, body: JSON.stringify({ source }) });
      return id;
    }, SOURCE);

    await page.goto(`${env.baseUrl}/project/${projectId}/problems`);
    const panel = page.getByTestId("problems");
    const orderLines = panel.locator('[data-table="OrderLines"]');
    const rule = (id: string) => orderLines.locator(`[data-rule="${id}"]`);
    await rule("pk-required").waitFor();
    assert.equal(await rule("pk-required").getAttribute("data-severity"), "warning");
    assert.equal(await rule("fk-indexed").count(), 1);
    assert.equal(await rule("naming-snake-case").count(), 1);
    // The tab carries the number of findings.
    const tab = page.getByRole("tab", { name: /Problèmes/ });
    const countBefore = Number((await tab.textContent())!.replace(/\D/g, ""));
    assert.ok(countBefore >= 6, `expected at least 6 findings, the tab says ${countBefore}`);
    await snap("findings");

    // The two fixes that need no decision.
    await rule("pk-required").getByRole("button", { name: "Ajouter une clé « id »" }).click();
    await rule("pk-required").waitFor({ state: "detached" });
    await rule("fk-indexed").getByRole("button", { name: "Créer l'index" }).click();
    await rule("fk-indexed").waitFor({ state: "detached" });
    assert.equal(Number((await tab.textContent())!.replace(/\D/g, "")), countBefore - 2);

    // A stricter profile raises what is left; an exception removes one finding.
    const settings = page.getByTestId("lint-settings");
    await settings.getByRole("radio", { name: "Strict" }).click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-table="OrderLines"] [data-rule="naming-snake-case"]')
          ?.getAttribute("data-severity") === "error",
    );
    await rule("naming-snake-case").getByRole("button", { name: "Ignorer pour cette table" }).click();
    await rule("naming-snake-case").waitFor({ state: "detached" });
    await settings.getByRole("list", { name: "Exceptions" }).getByText("OrderLines").waitFor();

    // One rule changed by hand: the profile becomes a custom one.
    await settings.locator('[data-rule="timestamps"]').getByRole("combobox").click();
    await page.getByRole("option", { name: "Erreur" }).click();
    await settings.getByRole("radio", { name: "Perso" }).and(page.locator('[aria-checked="true"]')).waitFor();
    await settings.getByRole("switch", { name: /Refuser un déploiement/ }).click();
    await panel.getByText(/bloquent le déploiement/).waitFor();
    await snap("strict");

    // Kept by the server, and what the server lints is what the browser fixed.
    await page.reload();
    await settings.getByRole("radio", { name: "Perso" }).and(page.locator('[aria-checked="true"]')).waitFor();
    await settings.getByRole("list", { name: "Exceptions" }).getByText("OrderLines").waitFor();
    const report = await page.evaluate(async (id) => {
      const res = await fetch(`/api/v1/projects/${id}/lint`);
      return (await res.json()) as {
        profile: string;
        blockDeployment: boolean;
        summary: { error: number };
        findings: { ruleId: string; tableName: string }[];
      };
    }, projectId);
    assert.equal(report.profile, "custom");
    assert.equal(report.blockDeployment, true);
    const left = report.findings.filter((f) => f.tableName === "OrderLines").map((f) => f.ruleId);
    assert.ok(
      !left.includes("pk-required") && !left.includes("fk-indexed") && !left.includes("naming-snake-case"),
      left.join(),
    );
    assert.equal(report.summary.error, 2, "created_at / updated_at missing on both tables, now an error");

    // A finding leads to its table on the canvas.
    await orderLines.getByRole("button", { name: "Ouvrir dans le schéma" }).click();
    await page.waitForURL(`${env.baseUrl}/project/${projectId}`);
    await page.locator(".svelte-flow__node").filter({ hasText: "OrderLines" }).first().waitFor();
    await snap("schema");

    assert.deepEqual(errors, []);
  } finally {
    await env.teardown();
  }
});
