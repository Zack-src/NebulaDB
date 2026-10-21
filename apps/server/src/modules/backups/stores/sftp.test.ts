import { test } from "node:test";
import assert from "node:assert/strict";
import crypto, { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import SftpClient from "ssh2-sftp-client";
import { useTestDatabase } from "../../../infrastructure/testDatabase.js";

// The outbound-host check pulls in the server's configuration, which wants a database URL.
await useTestDatabase("sftp-store");
const { SftpStore, fingerprintOf, normalizeFingerprint } = await import("./sftp.js");
const { REMOTE_HINT, SFTP, WRONG_FINGERPRINT, sftpHostKey } = await import("./testRemotes.js");
const { ObjectMissingError } = await import("./types.js");

// The SFTP implementation against the atmoz/sftp container of docker-compose.test.yml.

const MB = 1024 * 1024;

test("a host key fingerprint is `SHA256:` and 43 base64 characters, nothing else", () => {
  const fingerprint = fingerprintOf(Buffer.from("a host key"));
  assert.match(fingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/);
  assert.equal(normalizeFingerprint(` ${fingerprint}= `), fingerprint);
  assert.equal(normalizeFingerprint("MD5:aa:bb:cc"), null);
  assert.equal(normalizeFingerprint(fingerprint.replace("SHA256:", "")), null);
  assert.equal(normalizeFingerprint(""), null);
  assert.throws(() => new SftpStore(SFTP.settings("nope"), SFTP.secret), /fingerprint/);
});

test("the SFTP store streams, reads back, deletes, probes, and removes a partial file", async (t) => {
  const fingerprint = await sftpHostKey();
  if (!fingerprint) {
    t.skip(`no SFTP test container reachable at ${SFTP.host}:${SFTP.port} (${REMOTE_HINT})`);
    return;
  }
  const folder = `${SFTP.remoteDir}/${randomUUID().slice(0, 8)}`;
  const store = new SftpStore(SFTP.settings(fingerprint, folder), SFTP.secret);
  const lister = new SftpClient();
  await lister.connect({ host: SFTP.host, port: SFTP.port, username: SFTP.username, password: SFTP.secret.password });
  try {
    const names = async () => (await lister.list(folder)).map((entry) => entry.name);

    await store.probe();
    assert.deepEqual(await names(), [], "the probe file is removed, and the folder was created");

    const hash = crypto.createHash("sha256");
    async function* chunks(total: number, failAfter?: number): AsyncGenerator<Buffer> {
      for (let sent = 0; sent < total; sent += MB) {
        if (failAfter !== undefined && sent >= failAfter) throw new Error("the backup was cancelled");
        const chunk = crypto.randomBytes(MB);
        if (failAfter === undefined) hash.update(chunk);
        yield chunk;
      }
    }
    await store.write("big.bak", Readable.from(chunks(10 * MB)));
    assert.deepEqual(await names(), ["big.bak"]);
    const back = crypto.createHash("sha256");
    for await (const chunk of await store.read("big.bak")) back.update(chunk as Buffer);
    assert.equal(back.digest("hex"), hash.digest("hex"));

    // The source dies half-way: the partial file is gone.
    await assert.rejects(store.write("cut.bak", Readable.from(chunks(40 * MB, 10 * MB))), /cancelled/);
    assert.deepEqual(await names(), ["big.bak"]);

    const source = Readable.from(chunks(40 * MB));
    const cancelled = store.write("destroyed.bak", source);
    cancelled.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 200));
    source.destroy();
    await assert.rejects(cancelled);
    assert.deepEqual(await names(), ["big.bak"]);

    await store.delete("big.bak");
    await store.delete("big.bak");
    assert.deepEqual(await names(), []);
    await assert.rejects(store.read("big.bak"), ObjectMissingError);
    await lister.rmdir(folder, true);
  } finally {
    await lister.end().catch(() => {});
  }
});

test("the SFTP store never accepts a host key it was not given, and says why", async (t) => {
  const fingerprint = await sftpHostKey();
  if (!fingerprint) {
    t.skip(`no SFTP test container reachable at ${SFTP.host}:${SFTP.port} (${REMOTE_HINT})`);
    return;
  }
  const impostor = new SftpStore(SFTP.settings(WRONG_FINGERPRINT), SFTP.secret);
  await assert.rejects(
    impostor.probe(),
    (err: Error) => err.message.includes("does not match") && err.message.includes(fingerprint),
  );
  await assert.rejects(impostor.read("x.bak"), /does not match/);

  const wrongPassword = new SftpStore(SFTP.settings(fingerprint), { password: "wrong" });
  await assert.rejects(wrongPassword.probe(), /authentication|All configured/i);
});

test("the SFTP store refuses the cloud metadata endpoint", async () => {
  const store = new SftpStore({ ...SFTP.settings(WRONG_FINGERPRINT), host: "169.254.169.254" }, SFTP.secret);
  await assert.rejects(store.probe(), /metadata endpoint/);
});
