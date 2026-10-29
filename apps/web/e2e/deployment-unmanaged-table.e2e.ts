import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * A table the database holds that the schema lacks is a conflict when nobody at Nebula put it there,
 * empty or not, and stays one after a deployment that kept it. A table a deployment created and the
 * developer then took out of the schema is an ordinary removal: only data would make it a conflict.
 */

const PORT = Number(process.env.E2E_PORT) || 4441;

test(
  "deployment conflicts: a table made by hand is one, a table the developer removed is not",
  { timeout: 90_000 },
  async () => {
    const targetFile = join(mkdtempSync(join(tmpdir(), "nebuladb-e2e-unmanaged-")), "shop.sqlite");
    const target = new Database(targetFile);
    target.exec(
      "CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE a_test (id INTEGER PRIMARY KEY);",
    );
    target.close();

    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
      page.setDefaultTimeout(15_000);
      await login(page, env.baseUrl);
      const { projectId, connectionId } = await page.evaluate(
        async ({ filePath }) => {
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
            body: JSON.stringify({
              source: "Table customers {\n  id integer [pk]\n  name text\n}\nTable temp {\n  id integer [pk]\n}\n",
            }),
          });
          await fetch(`/api/projects/${id}/connections`, {
            method: "POST",
            headers: json,
            body: JSON.stringify({ name: "Base boutique", engine: "sqlite", filePath }),
          });
          const list = (await (await fetch(`/api/projects/${id}/connections`)).json()) as {
            connections: { id: string }[];
          };
          return { projectId: id, connectionId: list.connections[0].id };
        },
        { filePath: targetFile },
      );

      const api = (path: string, body: unknown) =>
        page.evaluate(
          async ({ url, payload }) => {
            const res = await fetch(url, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            });
            return (await res.json()) as {
              risks?: {
                type: string;
                tableName: string;
                affectedRowCount: number;
                severity: string;
                defaultStrategy: string;
              }[];
            };
          },
          { url: `/api/projects/${projectId}/connections/${connectionId}/${path}`, payload: body },
        );
      const conflicts = async () => {
        const plan = await api("plan-deployment", {});
        if (!plan.risks) throw new Error(JSON.stringify(plan));
        return plan.risks.map((risk) => `${risk.type} ${risk.tableName}`).sort();
      };

    // 1. Never deployed: `a_test` was made by hand, and being empty does not make it harmless.
      assert.deepEqual(await conflicts(), ["UNMANAGED_TABLE a_test"]);
      const [risk] = (await api("plan-deployment", {})).risks!;
      assert.deepEqual([risk.affectedRowCount, risk.severity, risk.defaultStrategy], [0, "critical", "KEEP_IN_DB"]);
      await page.goto(`${env.baseUrl}/project/${projectId}/deployments`);
      await page
        .getByTestId("deployment-panel")
        .getByText(/a_test.*pas dans le graphe/)
        .waitFor();

      // 2. Deployed with the table kept: it is still not Nebula's.
      await api("apply-deployment", { resolutions: {} });
      assert.deepEqual(await conflicts(), ["UNMANAGED_TABLE a_test"]);

      // 3. The developer takes `temp` (deployed above) out of the schema: a plain removal, empty, no conflict.
      await page.evaluate(
        async ({ id }) =>
          fetch(`/api/projects/${id}/import`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ source: "Table customers {\n  id integer [pk]\n  name text\n}\n" }),
          }),
        { id: projectId },
      );
      assert.deepEqual(await conflicts(), ["UNMANAGED_TABLE a_test"]);
    } finally {
      await env.teardown();
    }
  },
);
