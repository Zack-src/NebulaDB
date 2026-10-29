import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "playwright-core";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Admin → Liens de partage turns them on → project card → create a link →
 * the address is shown once → a fresh browser with no session opens it: the
 * diagram and the dictionary, read-only, from the share endpoints only, with
 * no cookie on any request → the link is revoked and stops working. What the
 * public answers hold and every refusal are covered server-side in
 * `apps/server/src/modules/shareLinks/routes.test.ts`.
 */

const PORT = Number(process.env.E2E_PORT) || 4523;

const SCHEMA = `Table customers {
  id int [pk]
  email varchar [note: 'Login address. [owner: jeanne.martin@corp.example] [class: personal]']
  Note: 'People who bought something. [owner: Jeanne Martin] [tags: crm]'
}

Table orders {
  id int [pk]
  customer_id int [ref: > customers.id]
}
`;

/** What each request really sent — the network stack adds cookies and `Referer` after the page asks. */
async function sentRequests(list: Request[]) {
  return Promise.all(
    list.map(async (request) => {
      const headers = await request.allHeaders();
      return { url: new URL(request.url()), cookie: headers.cookie, referer: headers.referer };
    }),
  );
}

test(
  "create a share link and open it without an account: read-only, share endpoints only, revocable",
  { timeout: 90_000 },
  async () => {
    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage();
      page.setDefaultTimeout(15_000);
      await login(page, env.baseUrl);
      await page.evaluate(async (source) => {
        const created = await fetch("/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Shop" }),
        });
        const { id } = (await created.json()) as { id: string };
        await fetch(`/api/projects/${id}/import`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source }),
        });
      }, SCHEMA);

      // Off by default: turned on from the admin console.
      await page.goto(`${env.baseUrl}/#admin`);
      await page.getByRole("button", { name: "Liens de partage", exact: true }).click();
      const allow = page.getByRole("switch", { name: /Autoriser les liens de partage/ });
      assert.equal(await allow.getAttribute("aria-checked"), "false");
      await allow.click();
      for (let attempt = 0; attempt < 100 && (await allow.getAttribute("aria-checked")) !== "true"; attempt++) {
        await page.waitForTimeout(50);
      }
      assert.equal(await allow.getAttribute("aria-checked"), "true");

      await page.goto(env.baseUrl);
      await page.getByRole("button", { name: "Liens de partage", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Liens de partage — Shop" });
      await dialog.getByLabel("Libellé du lien").fill("Pour les auditeurs");
      await dialog.getByRole("button", { name: "Créer le lien" }).click();
      const url = (await dialog.getByTestId("share-link-url").innerText()).trim();
      assert.match(url, new RegExp(`^${env.baseUrl}/share/nds_[A-Za-z0-9_-]{43}$`));
      await dialog.getByText("Pour les auditeurs", { exact: true }).waitFor();

      // A stranger: a fresh browser context, no cookie at all.
      const stranger = await env.browser.newContext();
      const viewer = await stranger.newPage();
      viewer.setDefaultTimeout(15_000);
      const requests: Request[] = [];
      viewer.on("request", (request) => void requests.push(request));
      const response = await viewer.goto(url);
      assert.equal(response?.headers()["referrer-policy"], "no-referrer");
      assert.equal(response?.headers()["cache-control"], "no-store");
      assert.match(String(response?.headers()["x-robots-tag"]), /noindex/);

      await viewer.getByTestId("share-project-name").getByText("Shop").waitFor();
      await viewer.getByTestId("share-diagram").locator("img").waitFor();
      await viewer.getByRole("radio", { name: "Dictionnaire" }).click();
      const dictionary = viewer.getByTestId("share-dictionary");
      await dictionary.getByText("People who bought something.").waitFor();
      await dictionary.getByText("Login address.").waitFor();
      const text = await dictionary.innerText();
      assert.ok(
        !text.includes("Jeanne Martin") && !text.includes("jeanne.martin"),
        "the owner annotation is not shown",
      );
      assert.equal(await viewer.getByRole("textbox", { name: /Description/ }).count(), 0, "nothing to edit");

      const sent = await sentRequests(requests);
      for (const request of sent) {
        assert.equal(request.url.origin, env.baseUrl, `${request.url.href} leaves the instance`);
        assert.ok(
          !request.url.pathname.startsWith("/api/") || request.url.pathname.startsWith("/api/share/"),
          `${request.url.pathname} is not a share endpoint`,
        );
        // A font is fetched with its stylesheet's address as Referer: allowed, it holds no token.
        assert.ok(!request.referer?.includes("/share/"), `${request.url.pathname} carries the share address`);
        assert.equal(request.cookie, undefined, `${request.url.pathname} carries a cookie`);
      }
      assert.ok(sent.some((request) => request.url.pathname.startsWith("/api/share/")));
      assert.equal((await stranger.cookies()).length, 0, "no cookie was set");

      // The signed-in admin opening the same link: the API calls go out without the session cookie.
      const own: Request[] = [];
      page.on("request", (request) => void own.push(request));
      await page.goto(url);
      await page.getByTestId("share-diagram").locator("img").waitFor();
      for (const request of await sentRequests(own)) {
        if (request.url.pathname.startsWith("/api/")) {
          assert.ok(request.url.pathname.startsWith("/api/share/"), `${request.url.pathname} called while signed in`);
          assert.equal(request.cookie, undefined, `${request.url.pathname} sent the viewer's session`);
        }
      }

      // Revoked: the next visit gets the one answer every dead link gets.
      await page.goto(env.baseUrl);
      await page.getByRole("button", { name: "Liens de partage", exact: true }).click();
      await page.getByRole("button", { name: "Révoquer le lien « Pour les auditeurs »" }).click();
      await page.getByText("Révoqué", { exact: true }).waitFor();
      await viewer.reload();
      await viewer.getByText("Ce lien n'existe pas ou ne fonctionne plus.").waitFor();
      await stranger.close();
    } finally {
      await env.teardown();
    }
  },
);
