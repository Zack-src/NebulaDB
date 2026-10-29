import test from "node:test";
import assert from "node:assert/strict";
import ssh2 from "ssh2";
import type { DatabaseConnectionConfig } from "@nebuladb/shared";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

// `ApiError` records what it reports, through NebulaDB's own database.
await useTestDatabase("connsecurity");
const { ApiError } = await import("../../shared/errors.js");
const { mergeSecurity, normalizeSecurity, securitySummary } = await import("./security.js");

const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
const KEY = "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----";
const sshKey = ssh2.utils.generateKeyPairSync("ed25519").private;

const base = (extra: Partial<DatabaseConnectionConfig> = {}) =>
  ({
    id: "c",
    projectId: "",
    name: "c",
    engine: "postgres",
    host: "db",
    port: 5432,
    ...extra,
  }) as DatabaseConnectionConfig;

const code = (expected: string) => (err: unknown) => err instanceof ApiError && err.code === expected;

test("TLS settings: PEM text only, a key needs its certificate", () => {
  const config = base({ ssl: true, sslCa: `  ${PEM}  `, sslVerify: true });
  normalizeSecurity(config);
  assert.equal(config.sslCa, `${PEM}\n`);
  assert.throws(() => normalizeSecurity(base({ sslCa: "not a certificate" })), code("CONNECTION_TLS_INVALID"));
  assert.throws(() => normalizeSecurity(base({ sslKey: KEY })), code("CONNECTION_TLS_INVALID"));
  const empty = base({ sslCa: "  " });
  normalizeSecurity(empty);
  assert.equal("sslCa" in empty, false);
});

test("SSH tunnel: host, user and a password or a readable key; host and port only", () => {
  const ok = base({ sshTunnel: { host: " bastion ", user: "deploy", privateKey: sshKey } });
  normalizeSecurity(ok);
  assert.equal(ok.sshTunnel?.host, "bastion");
  assert.equal(ok.sshTunnel?.port, 22);

  const invalid = code("CONNECTION_SSH_INVALID");
  assert.throws(() => normalizeSecurity(base({ sshTunnel: { host: "b", user: "u" } })), invalid);
  assert.throws(() => normalizeSecurity(base({ sshTunnel: { host: "b", user: "u", privateKey: "junk" } })), invalid);
  assert.throws(
    () => normalizeSecurity(base({ sshTunnel: { host: "b", user: "u", password: "p", port: 70000 } })),
    invalid,
  );
  assert.throws(
    () => normalizeSecurity(base({ sshTunnel: { host: "b", user: "u", password: "p", hostKeyFingerprint: "md5:aa" } })),
    invalid,
  );
  assert.throws(
    () => normalizeSecurity(base({ engine: "sqlite", sshTunnel: { host: "b", user: "u", password: "p" } })),
    invalid,
  );
  assert.throws(
    () =>
      normalizeSecurity(
        base({ connectionString: "postgres://x/y", sshTunnel: { host: "b", user: "u", password: "p" } }),
      ),
    invalid,
  );
});

test("an update keeps the secrets it did not send again, and null removes them", () => {
  const stored = base({
    ssl: true,
    sslCert: `${PEM}\n`,
    sslKey: `${KEY}\n`,
    sshTunnel: { host: "bastion", port: 22, user: "deploy", password: "pw" },
  });
  const summary = securitySummary(stored);
  assert.equal(JSON.stringify(summary).includes("pw"), false);
  assert.equal(JSON.stringify(summary).includes("PRIVATE"), false);
  assert.deepEqual(summary.sshTunnel, {
    host: "bastion",
    port: 22,
    user: "deploy",
    hasPassword: true,
    hasPrivateKey: false,
  });
  assert.equal(summary.hasSslKey, true);

  // The form sends back what the summary showed, without the secrets.
  const sent = {
    sslKey: "",
    sshTunnel: { host: "bastion", port: 2222, user: "deploy" },
  } as Partial<DatabaseConnectionConfig>;
  const merged = { ...stored, ...sent } as DatabaseConnectionConfig;
  mergeSecurity(stored, sent, merged);
  assert.equal(merged.sslKey, `${KEY}\n`);
  assert.equal(merged.sshTunnel?.password, "pw");
  assert.equal(merged.sshTunnel?.port, 2222);

  // Another SSH server: the old password is not handed to it.
  const moved = { sshTunnel: { host: "elsewhere", user: "deploy" } } as Partial<DatabaseConnectionConfig>;
  assert.throws(
    () => mergeSecurity(stored, moved, { ...stored, ...moved } as DatabaseConnectionConfig),
    code("CONNECTION_SSH_INVALID"),
  );

  const removed = { sslKey: null, sslCert: "", sshTunnel: null } as unknown as Partial<DatabaseConnectionConfig>;
  const cleared = { ...stored, ...removed } as DatabaseConnectionConfig;
  mergeSecurity(stored, removed, cleared);
  assert.equal(cleared.sslKey, undefined);
  assert.equal(cleared.sshTunnel, undefined);
});
