import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";
import { ADMIN_EMAIL, startE2eEnvironment } from "./harness.js";

/**
 * "Forgot password" end to end: the link on the login page, the email
 * actually leaving the server over SMTP (to an in-process `smtp-server`, so
 * no external mail service is involved), following the emailed link in the
 * browser, and signing in with the new password. The REST edge cases (unknown
 * address, reuse, expiry, disabled account) live in
 * `apps/server/src/modules/auth/passwordResetRoutes.test.ts`.
 */

const PORT = Number(process.env.E2E_PORT) || 4395;

test("forgot password → emailed link → new password → sign in with it", { timeout: 60_000 }, async () => {
  const inbox: string[] = [];
  const smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    onData(stream, _session, callback) {
      let raw = "";
      stream.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
      stream.on("end", () => {
        inbox.push(raw.replace(/=\r?\n/g, "").replace(/=3D/g, "="));
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => smtp.listen(0, "127.0.0.1", resolve));
  const smtpPort = (smtp.server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${PORT}`;

  const env = await startE2eEnvironment(PORT, {
    ATHANORDB_PUBLIC_URL: baseUrl,
    ATHANORDB_SMTP_HOST: "127.0.0.1",
    ATHANORDB_SMTP_PORT: String(smtpPort),
    ATHANORDB_SMTP_SECURE: "false",
    ATHANORDB_SMTP_FROM: "AthanorDB <noreply@example.test>",
  });
  try {
    const page = await env.browser.newPage();
    page.setDefaultTimeout(15_000);
    await page.goto(env.baseUrl);
    await page.getByRole("button", { name: "Mot de passe oublié ?" }).click();
    await page.getByLabel("Adresse e-mail").fill(ADMIN_EMAIL);
    await page.getByRole("button", { name: "Envoyer le lien" }).click();
    await page.getByText(`Si un compte existe pour ${ADMIN_EMAIL}`).waitFor();

    const deadline = Date.now() + 10_000;
    while (inbox.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    const link = inbox[0]?.match(/http:\/\/127\.0\.0\.1:\d+\/reset-password\/[A-Za-z0-9_-]+/)?.[0];
    if (!link) throw new Error(`no reset link received:\n${inbox[0] ?? "(no email)"}`);

    const newPassword = "a fresh passphrase chosen in the browser";
    await page.goto(link);
    await page.getByLabel("Nouveau mot de passe").fill(newPassword);
    await page.getByLabel("Confirmer le mot de passe").fill(newPassword);
    await page.getByRole("button", { name: "Enregistrer le mot de passe" }).click();

    // Back on the login screen, email pre-filled, with the "password changed" banner.
    await page.getByText("Mot de passe modifié").waitFor();
    await page.getByLabel("Mot de passe", { exact: true }).fill(newPassword);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.getByRole("button", { name: "Nouveau projet" }).first().waitFor();
  } finally {
    await env.teardown();
    await new Promise<void>((resolve) => smtp.close(() => resolve()));
  }
});
