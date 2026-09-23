import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * Project card → Webhooks → add one pointing at a receiver in this process →
 * the signing secret is shown once → "Tester" delivers a real signed POST.
 * Delivery rules (retries, coalescing, SSRF) are covered server-side in
 * `modules/webhooks/routes.test.ts`.
 */

const PORT = Number(process.env.E2E_PORT) || 4387;

test(
  "add a webhook from the project card, see its secret once, and send a test that really arrives",
  { timeout: 60_000 },
  async () => {
    const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
    const receiver = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
      req.on("end", () => {
        received.push({ headers: req.headers, body });
        res.end("ok");
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
    const receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;

    const env = await startE2eEnvironment(PORT);
    try {
      const page = await env.browser.newPage();
      page.setDefaultTimeout(15_000);
      await login(page, env.baseUrl);
      await page.evaluate(async () => {
        await fetch("/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Hooked", template: "blog" }),
        });
      });
      await page.reload();

      await page.getByRole("button", { name: "Webhooks", exact: true }).click();
      await page.getByLabel("Adresse du webhook").fill(receiverUrl);
      await page.getByLabel("Format").selectOption("json");
      await page.getByRole("button", { name: "Ajouter" }).click();

      const secret = (await page.getByTestId("webhook-secret").innerText()).trim();
      assert.match(secret, /^whsec_/);

      await page.getByRole("button", { name: "Tester" }).click();
      await page.getByText("Envoyé", { exact: true }).waitFor();
      assert.equal(received.length, 1);
      assert.equal(received[0].headers["x-athanordb-event"], "ping");
      assert.match(String(received[0].headers["x-athanordb-signature"]), /^t=\d+,v1=[0-9a-f]{64}$/);
      assert.equal(JSON.parse(received[0].body).project.name, "Hooked");
    } finally {
      await env.teardown();
      await new Promise<void>((resolve) => receiver.close(() => resolve()));
    }
  },
);
