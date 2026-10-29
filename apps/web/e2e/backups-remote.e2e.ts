import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CreateBucketCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import Database from "better-sqlite3";
import { login, startE2eEnvironment } from "./harness.js";

/**
 * A database's backups sent to an S3-compatible bucket from the "Sauvegardes"
 * tab: a wrong bucket is refused with the remote's reason, the right one is
 * saved, a backup lands in the bucket and says where it is, and the keys are
 * never shown again. Needs the MinIO container of `docker-compose.test.yml`
 * (skipped when it is not running).
 */

const PORT = Number(process.env.E2E_PORT) || 4524;
const MINIO = {
  host: process.env.NEBULADB_TEST_S3_HOST || "127.0.0.1",
  port: Number(process.env.NEBULADB_TEST_S3_PORT || 59000),
  key: process.env.NEBULADB_TEST_S3_KEY || "nebuladb_test",
  secret: process.env.NEBULADB_TEST_S3_SECRET || "nebuladb_test_secret",
};

test("backups: send them to an S3 bucket", { timeout: 90_000 }, async (t) => {
  const endpoint = `http://${MINIO.host}:${MINIO.port}`;
  const s3 = new S3Client({
    region: "us-east-1",
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: MINIO.key, secretAccessKey: MINIO.secret },
  });
  const bucket = `nebuladb-e2e-${randomUUID().slice(0, 8)}`;
  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch {
    t.skip(`no MinIO test container reachable at ${endpoint}`);
    return;
  }

  const targetFile = join(mkdtempSync(join(tmpdir(), "nebuladb-e2e-backups-remote-")), "shop.sqlite");
  const target = new Database(targetFile);
  target.exec("CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO customers VALUES (1, 'Ada');");
  target.close();

  const env = await startE2eEnvironment(PORT);
  try {
    const page = await env.browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    await login(page, env.baseUrl);
    await page.evaluate(async (filePath) => {
      const json = { "content-type": "application/json" };
      await fetch("/api/admin/connections", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ name: "Base boutique", engine: "sqlite", filePath }),
      });
    }, targetFile);

    await page.goto(env.baseUrl);
    await page
      .getByRole("navigation", { name: "Navigation principale", exact: true })
      .getByRole("button", { name: "Admin", exact: true })
      .click();
    await page.getByRole("button", { name: "Connexions base de données", exact: true }).click();
    await page.getByRole("button", { name: "Monitoring", exact: true }).click();
    await page.getByRole("tab", { name: "Sauvegardes", exact: true }).click();

    const card = page.getByTestId("backup-destination");
    await card.getByRole("radio", { name: "S3", exact: true }).click();
    await card.getByLabel("Point d'accès (URL)").fill(endpoint);
    await card.getByLabel("Bucket", { exact: true }).fill(`${bucket}-missing`);
    await card.getByLabel("Préfixe des clés").fill("nebula/boutique");
    await card.getByLabel("Identifiant de clé d'accès").fill(MINIO.key);
    await card.getByLabel("Clé d'accès secrète").fill(MINIO.secret);
    await card.getByRole("checkbox").check({ force: true });
    await card.getByRole("button", { name: "Tester et enregistrer" }).click();
    await card.getByText(/Impossible d'écrire/).waitFor();

    await card.getByLabel("Bucket", { exact: true }).fill(bucket);
    await card.getByRole("button", { name: "Tester et enregistrer" }).click();
    await card.getByText("Emplacement enregistré").waitFor();

    const panel = page.getByTestId("backups");
    await panel.getByRole("button", { name: "Sauvegarder maintenant" }).click();
    const done = panel.locator('tr[data-status="done"]');
    await done.first().waitFor();
    await done.first().getByText(`s3://${bucket}/nebula/boutique/`, { exact: false }).waitFor();

    const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
    assert.equal(listed.Contents?.length, 1);
    assert.match(listed.Contents?.[0].Key ?? "", /^nebula\/boutique\/.+\.bak$/);

    // The keys are saved, not shown: after a reload the fields are empty and say so.
    await page.reload();
    await page
      .getByRole("navigation", { name: "Navigation principale", exact: true })
      .getByRole("button", { name: "Admin", exact: true })
      .click();
    await page.getByRole("button", { name: "Connexions base de données", exact: true }).click();
    await page.getByRole("button", { name: "Monitoring", exact: true }).click();
    await page.getByRole("tab", { name: "Sauvegardes", exact: true }).click();
    const reloaded = page.getByTestId("backup-destination");
    await reloaded.getByLabel("Bucket", { exact: true }).waitFor();
    assert.equal(await reloaded.getByLabel("Bucket", { exact: true }).inputValue(), bucket);
    assert.equal(await reloaded.getByLabel("Clé d'accès secrète").inputValue(), "");
    await reloaded.getByText(/Des identifiants sont enregistrés/).waitFor();

    assert.deepEqual(errors, []);
  } finally {
    await env.teardown();
  }
});
