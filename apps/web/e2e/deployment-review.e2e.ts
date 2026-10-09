import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADMIN_EMAIL, login, startE2eEnvironment } from "./harness.js";

/**
 * Review before a "Revue" stage: the deployment dialog ends on "Demander une
 * revue" instead of deploying, a colleague who has the project's "Déploiement"
 * level approves it from the Déploiements tab, and the author then deploys
 * the approved request — which the history credits to both.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each step.
 */

const PORT = Number(process.env.E2E_PORT) || 4452;
const COLLEAGUE_EMAIL = "e2e-reviewer@example.com";
const COLLEAGUE_PASSWORD = "correct horse battery staple reviewer";

test(
  "review: requested from the dialog, approved by a colleague, deployed by its author",
  { timeout: 120_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "nebuladb-e2e-review-"));
    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage({ viewport: { width: 1400, height: 1000 } });
      page.setDefaultTimeout(15_000);
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(String(err)));
      const snap = async (name: string, target = page) => {
        if (process.env.E2E_SHOTS) await target.screenshot({ path: join(process.env.E2E_SHOTS, `review-${name}.png`) });
      };
      await login(page, env.baseUrl);

      // DEV free › Staging "Revue"; a project with a database on each, DEV already deployed;
      // a colleague given the "Déploiement" level on the project.
      // Through the page's own session, from here: the setup is not what is under test.
      const api = async <T>(method: "GET" | "POST" | "PUT" | "PATCH", url: string, data?: unknown): Promise<T> => {
        const res = await page.request.fetch(`${env.baseUrl}${url}`, {
          method,
          headers: { origin: env.baseUrl },
          ...(data === undefined ? {} : { data }),
        });
        assert.ok(res.ok(), `${method} ${url}: ${res.status()} ${await res.text()}`);
        return (await res.json()) as T;
      };
      const chain = await api<{ environments: { id: string; name: string }[] }>("GET", "/api/environments");
      const stageId = (name: string) => chain.environments.find((entry) => entry.name === name)!.id;
      await api("PATCH", `/api/admin/environments/${stageId("DEV")}`, { protection: "free" });
      await api("PATCH", `/api/admin/environments/${stageId("Staging")}`, { protection: "review" });
      const { id: projectId } = await api<{ id: string }>("POST", "/api/projects", { name: "Boutique" });
      await api("POST", `/api/projects/${projectId}/import`, { source: "Table customers {\n  id integer [pk]\n}\n" });
      const connect = async (name: string, environment: string) =>
        (
          await api<{ connection: { id: string } }>("POST", `/api/projects/${projectId}/connections`, {
            name,
            engine: "sqlite",
            filePath: join(dir, `${environment}.sqlite`),
            environment,
          })
        ).connection.id;
      const devId = await connect("Base dev", "DEV");
      const stagingId = await connect("Base staging", "Staging");
      await api("POST", `/api/projects/${projectId}/connections/${devId}/apply-deployment`, { resolutions: {} });
      const { token } = await api<{ token: string }>("POST", "/api/invitations", { email: COLLEAGUE_EMAIL });
      await api("POST", `/api/invitations/${token}/accept`, { password: COLLEAGUE_PASSWORD });
      const users = await api<{ id: string; email: string }[]>("GET", "/api/users");
      const colleagueId = users.find((user) => user.email === COLLEAGUE_EMAIL)!.id;
      await api("PUT", `/api/projects/${projectId}/members/${colleagueId}`, { permission: "deploy" });

      // --- The author: the dialog's last step asks for a review ---
      await page.goto(`${env.baseUrl}/project/${projectId}/deployments`);
      const pipeline = page.getByTestId("pipeline");
      await pipeline.locator('[data-stage="Staging"]').getByRole("button", { name: "Déployer" }).click();
      const panel = page.getByTestId("deployment-panel");
      await panel.getByRole("button", { name: "Prévisualiser le SQL" }).click();
      await panel.getByTestId("review-needed").waitFor();
      assert.equal(await panel.getByRole("button", { name: "Appliquer les modifications en base" }).count(), 0);
      await panel.getByLabel("Message pour la personne qui relit (facultatif)").fill("Première table");
      await snap("dialog");
      await panel.getByRole("button", { name: "Demander une revue" }).click();
      await panel.getByTestId("review-requested").waitFor();

      const card = page.getByTestId("deployment-reviews");
      const request = card.locator('[data-review="Base staging"]');
      await request.waitFor();
      assert.equal(await request.getAttribute("data-status"), "pending");
      await request.getByText("« Première table »").waitFor();
      // Their own request: nothing to approve, something to withdraw.
      await request.getByText("vous ne pouvez pas approuver votre propre demande").waitFor();
      assert.equal(await request.getByRole("button", { name: "Approuver" }).count(), 0);
      await request.getByRole("button", { name: "Retirer la demande" }).waitFor();
      await snap("requested");

      // --- The colleague: has the tab (level "Déploiement"), reads the SQL, approves ---
      const colleague = await env.browser.newContext({ viewport: { width: 1400, height: 1000 } });
      const signedIn = await colleague.request.post(`${env.baseUrl}/api/auth/login`, {
        headers: { origin: env.baseUrl },
        data: { email: COLLEAGUE_EMAIL, password: COLLEAGUE_PASSWORD },
      });
      assert.equal(signedIn.status(), 200);
      const theirs = await colleague.newPage();
      theirs.setDefaultTimeout(15_000);
      theirs.on("pageerror", (err) => errors.push(String(err)));
      await theirs.goto(`${env.baseUrl}/project/${projectId}/deployments`);
      const toReview = theirs.getByTestId("deployment-reviews").locator('[data-review="Base staging"]');
      await toReview.waitFor();
      assert.match(await toReview.getByLabel("SQL à exécuter").inputValue(), /CREATE TABLE/i);
      await toReview.getByText(`demandée par ${ADMIN_EMAIL}`).waitFor();
      assert.equal(await toReview.getByRole("button", { name: "Retirer la demande" }).count(), 0);
      await toReview.getByLabel("Commentaire").fill("Relu, conforme");
      await snap("to-review", theirs);
      await toReview.getByRole("button", { name: "Approuver" }).click();
      await theirs.locator('[data-review="Base staging"][data-status="approved"]').waitFor();
      // The approver may deploy it too.
      await toReview.getByRole("button", { name: "Déployer la demande approuvée" }).waitFor();

      // --- The author is told without reloading, and deploys what was approved ---
      await page.locator('[data-review="Base staging"][data-status="approved"]').waitFor();
      await request.getByText(`Approuvée par ${COLLEAGUE_EMAIL}`).waitFor();
      await request.getByText("« Relu, conforme »").waitFor();
      await snap("approved");
      await request.getByRole("button", { name: "Déployer la demande approuvée" }).click();
      await page.getByText("Demande approuvée déployée sur « Base staging ».").waitFor();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-stage="Staging"] [data-connection]')?.getAttribute("data-state") === "level",
      );
      await request.waitFor({ state: "detached" });

      // The history credits both.
      const history = await page.evaluate(
        async ({ projectId, stagingId }) =>
          (
            (await (await fetch(`/api/projects/${projectId}/connections/${stagingId}/history`)).json()) as {
              history: { review?: { requestedByEmail: string; approvedByEmail: string } }[];
            }
          ).history,
        { projectId, stagingId },
      );
      assert.deepEqual(
        [history[0].review?.requestedByEmail, history[0].review?.approvedByEmail],
        [ADMIN_EMAIL, COLLEAGUE_EMAIL],
      );
      await panel.getByRole("button", { name: "Historique" }).click();
      await panel.getByTestId("history-review").getByText(`approuvé par ${COLLEAGUE_EMAIL}`).waitFor();
      await snap("history");

      assert.deepEqual(errors, []);
    } finally {
      await env.teardown();
    }
  },
);
