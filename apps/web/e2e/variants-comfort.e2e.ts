import { test } from "node:test";
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * The shortcuts around folders and variants: a folder made by right-clicking
 * the list, a project dragged into it, a variant made from a project's
 * right-click menu; going from one variant to another from the project
 * header; a variant copied from another, reset on the original, renamed and
 * put in the trash from the original's Variantes tab.
 *
 * Set `E2E_SHOTS=<dir>` to keep a screenshot of each step.
 */

const PORT = Number(process.env.E2E_PORT) || 4430;

const ORIGINAL = `Table customers {
  id int [pk]
  name varchar
}
`;

async function api(page: Page, method: string, url: string, body?: unknown) {
  return page.evaluate(
    async ({ method, url, body }) => {
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, text: await res.text() };
    },
    { method, url, body },
  );
}

test(
  "folders and variants, the short way: right click, drag and drop, header switcher, reset, copy, rename, trash",
  { timeout: 150_000 },
  async () => {
    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage({ viewport: { width: 1400, height: 950 } });
      page.setDefaultTimeout(15_000);
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(String(err)));
      let shot = 0;
      const snap = async (name: string) => {
        if (process.env.E2E_SHOTS)
          await page.screenshot({ path: `${process.env.E2E_SHOTS}/variants-comfort-${++shot}-${name}.png` });
      };
      await login(page, env.baseUrl);
      const created = await api(page, "POST", "/api/projects", { name: "Socle" });
      const baseId = (JSON.parse(created.text) as { id: string }).id;
      assert.equal((await api(page, "POST", `/api/projects/${baseId}/import`, { source: ORIGINAL })).status, 200);
      await page.reload();

      // --- Right click on the list: a folder ---
      const list = page.getByTestId("project-list");
      await list.click({ button: "right", position: { x: 40, y: 600 } });
      await page.getByRole("menu", { name: "Projets" }).getByRole("menuitem", { name: "Nouveau dossier" }).click();
      await page.getByRole("dialog").getByLabel("Nom du dossier").fill("Clients");
      await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
      const folder = page.getByTestId("folder-tile").filter({ hasText: "Clients" });
      await folder.getByText("0 projet").waitFor();
      await snap("menu-folder");

      // --- The project dragged into it ---
      await page.getByTestId("project-tile").first().dragTo(folder);
      await folder.getByText("1 projet").waitFor();
      assert.equal(await page.getByTestId("project-tile").count(), 0);

      // --- Right click on the project, inside the folder: two variants ---
      await folder.getByRole("button", { name: /^Clients/ }).click();
      for (const name of ["Client A", "Client B"]) {
        await page
          .getByTestId("project-tile")
          .filter({ has: page.getByText("Socle", { exact: true }) })
          .click({ button: "right" });
        await page.getByRole("menuitem", { name: "Nouvelle variante client" }).click();
        await page.getByRole("dialog").getByLabel("Nom de la variante").fill(name);
        await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
        await page.getByTestId("project-tile").filter({ hasText: name }).waitFor();
      }
      await page.getByTestId("project-tile").filter({ hasText: "Client A" }).getByText("Variante de Socle").waitFor();
      await snap("variants-in-folder");

      // Client A makes a table of its own.
      const ids = JSON.parse((await api(page, "GET", "/api/projects")).text) as { id: string; name: string }[];
      const a = ids.find((p) => p.name === "Client A")!.id;
      const b = ids.find((p) => p.name === "Client B")!.id;
      await api(page, "POST", `/api/projects/${a}/import`, {
        source: `${ORIGINAL}\nTable a_only {\n  id int [pk]\n}\n`,
      });

      // --- From A to B through the header ---
      await page.getByTestId("project-tile").filter({ hasText: "Client A" }).click();
      await page.getByTestId("variant-switcher").click();
      await snap("switcher");
      await page.getByRole("menuitemcheckbox", { name: "Client B" }).click();
      await page.waitForURL(`**/project/${b}**`);

      // --- B copies A, then goes back to the original ---
      await page.getByRole("tab", { name: "Variantes" }).click();
      await page.getByRole("button", { name: "Copier depuis une autre variante" }).click();
      const copy = page.getByTestId("variant-copy");
      await copy.getByRole("button", { name: "Copier" }).click();
      await page.getByText("Variante copiée").waitFor();
      const exportB = async () => (await api(page, "GET", `/api/projects/${b}/export/dbml`)).text;
      assert.match(await exportB(), /a_only/);
      await page.getByRole("button", { name: "Réinitialiser sur l'original" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Réinitialiser sur l'original" }).click();
      await page.getByText("Variante réinitialisée sur l'original").waitFor();
      assert.doesNotMatch(await exportB(), /a_only/);

      // --- On the original: A renamed, then put in the trash ---
      await page.getByTestId("variant-switcher").click();
      await page.getByRole("menuitemcheckbox", { name: /Socle/ }).click();
      await page.waitForURL(`**/project/${baseId}**`);
      await page.getByRole("tab", { name: "Variantes" }).click();
      const rowA = page.getByTestId("variant-row").filter({ hasText: "Client A" });
      await rowA.getByRole("button", { name: "Actions sur Client A" }).click();
      await page.getByRole("menuitem", { name: "Renommer" }).click();
      const rename = page.getByRole("dialog", { name: "Renommer la variante" });
      await rename.getByRole("textbox").fill("Client A — Lyon");
      await rename.getByRole("button", { name: "Enregistrer" }).click();
      const renamed = page.getByTestId("variant-row").filter({ hasText: "Client A — Lyon" });
      await renamed.waitFor();
      await snap("renamed");
      await renamed.getByRole("button", { name: "Actions sur Client A — Lyon" }).click();
      await page.getByRole("menuitem", { name: "Mettre à la corbeille" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Mettre à la corbeille" }).click();
      await page.getByText("« Client A — Lyon » est dans la corbeille").waitFor();
      await renamed.waitFor({ state: "detached" });
      assert.equal(await page.getByTestId("variant-row").count(), 1);

      assert.deepEqual(errors, []);
    } finally {
      await env.teardown();
    }
  },
);
