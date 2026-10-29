import { test } from "node:test";
import assert from "node:assert/strict";
import crypto, { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { CreateBucketCommand, ListMultipartUploadsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { useTestDatabase } from "../../../infrastructure/testDatabase.js";

// The outbound-host check pulls in the server's configuration, which wants a database URL.
await useTestDatabase("s3-store");
const { S3Store, normalizePrefix, s3Reason } = await import("./s3.js");
const { MINIO, REMOTE_HINT, minioReachable } = await import("./testRemotes.js");
const { ObjectMissingError } = await import("./types.js");

// The S3 implementation against the MinIO container of docker-compose.test.yml.

const MB = 1024 * 1024;

test("a key prefix is normalised to `a/b/` or nothing", () => {
  assert.equal(normalizePrefix(""), "");
  assert.equal(normalizePrefix(" /backups/nebula// "), "backups/nebula/");
  assert.equal(normalizePrefix("x"), "x/");
});

test("the S3 store streams, reads back, deletes, probes, and leaves nothing behind when an upload fails", async (t) => {
  if (!(await minioReachable())) {
    t.skip(`no MinIO test container reachable at ${MINIO.host}:${MINIO.port} (${REMOTE_HINT})`);
    return;
  }
  const bucket = `nebuladb-test-${randomUUID().slice(0, 8)}`;
  const admin = new S3Client({
    region: "us-east-1",
    endpoint: MINIO.settings(bucket).endpoint,
    forcePathStyle: true,
    credentials: MINIO.secret,
  });
  await admin.send(new CreateBucketCommand({ Bucket: bucket }));
  const store = new S3Store(MINIO.settings(bucket, "nebula/backups"), MINIO.secret);
  const keys = async () =>
    ((await admin.send(new ListObjectsV2Command({ Bucket: bucket }))).Contents ?? []).map((object) => object.Key);

  // 20 MB of random bytes, in chunks: more than two multipart parts, never held whole by the store.
  const hash = crypto.createHash("sha256");
  async function* chunks(total: number, failAfter?: number): AsyncGenerator<Buffer> {
    for (let sent = 0; sent < total; sent += MB) {
      if (failAfter !== undefined && sent >= failAfter) throw new Error("the backup was cancelled");
      const chunk = crypto.randomBytes(MB);
      if (failAfter === undefined) hash.update(chunk);
      yield chunk;
    }
  }

  await store.probe();
  assert.deepEqual(await keys(), [], "the probe object is removed");

  await store.write("big.bak", Readable.from(chunks(20 * MB)));
  assert.deepEqual(await keys(), ["nebula/backups/big.bak"]);
  const back = crypto.createHash("sha256");
  for await (const chunk of await store.read("big.bak")) back.update(chunk as Buffer);
  assert.equal(back.digest("hex"), hash.digest("hex"));

  // The source dies half-way: the multipart upload is aborted, no object and no parts remain.
  await assert.rejects(store.write("cut.bak", Readable.from(chunks(40 * MB, 20 * MB))), /cancelled/);
  assert.deepEqual(await keys(), ["nebula/backups/big.bak"]);
  const pending = await admin.send(new ListMultipartUploadsCommand({ Bucket: bucket }));
  assert.deepEqual(pending.Uploads ?? [], []);

  // Destroyed without an error, the way a cancel does it.
  const source = Readable.from(chunks(40 * MB));
  const cancelled = store.write("destroyed.bak", source);
  cancelled.catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 150));
  source.destroy();
  await assert.rejects(cancelled);
  assert.deepEqual(await keys(), ["nebula/backups/big.bak"]);
  assert.deepEqual((await admin.send(new ListMultipartUploadsCommand({ Bucket: bucket }))).Uploads ?? [], []);

  await store.delete("big.bak");
  await store.delete("big.bak");
  assert.deepEqual(await keys(), []);
  await assert.rejects(store.read("big.bak"), ObjectMissingError);
});

test("the S3 store reports the remote's own reason when the bucket or the keys are wrong", async (t) => {
  if (!(await minioReachable())) {
    t.skip(`no MinIO test container reachable at ${MINIO.host}:${MINIO.port} (${REMOTE_HINT})`);
    return;
  }
  const missing = new S3Store(MINIO.settings(`no-such-${randomUUID().slice(0, 8)}`), MINIO.secret);
  await assert.rejects(missing.probe(), (err) => /NoSuchBucket/.test(s3Reason(err)));
  const denied = new S3Store(MINIO.settings("whatever"), { accessKeyId: "nobody", secretAccessKey: "wrong" });
  await assert.rejects(denied.probe(), (err) =>
    /InvalidAccessKeyId|SignatureDoesNotMatch|AccessDenied/.test(s3Reason(err)),
  );
  // Nothing listens there: the reason is the network's.
  const closed = new S3Store({ ...MINIO.settings("b"), endpoint: "http://127.0.0.1:1" }, MINIO.secret);
  await assert.rejects(closed.probe(), (err) => /ECONNREFUSED|connect/i.test(s3Reason(err)));
});

test("the S3 store refuses the cloud metadata endpoint", async () => {
  const store = new S3Store({ ...MINIO.settings("b"), endpoint: "http://169.254.169.254" }, MINIO.secret);
  await assert.rejects(store.probe(), /metadata endpoint/);
  await assert.rejects(store.read("x.bak"), /metadata endpoint/);
});
