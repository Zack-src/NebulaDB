import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import ssh2 from "ssh2";
import type { DatabaseConnectionConfig } from "@nebuladb/shared";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";
import { TEST_DB_HINT } from "./drivers/testDbAvailability.js";

// `ApiError` records what it reports, through NebulaDB's own database.
await useTestDatabase("sshtunnel");
const { ApiError } = await import("../../shared/errors.js");
const { PostgresDriver } = await import("./drivers/postgres.js");
const { hostKeyFingerprint, reachTarget, withTunnel } = await import("./sshTunnel.js");

const hostKey = ssh2.utils.generateKeyPairSync("ed25519");
const clientKey = ssh2.utils.generateKeyPairSync("ed25519");
const allowedKey = ssh2.utils.parseKey(clientKey.public) as ssh2.ParsedKey;
const hostFingerprint = hostKeyFingerprint((ssh2.utils.parseKey(hostKey.public) as ssh2.ParsedKey).getPublicSSH());

const pg = {
  host: process.env.NEBULADB_TEST_PG_HOST || "localhost",
  port: Number(process.env.NEBULADB_TEST_PG_PORT || 55432),
};

/** An SSH server of the test's own: user `tunnel`, password `secret` or `clientKey`, forwards anywhere. */
async function sshServer() {
  const forwarded: string[] = [];
  let open = 0;
  const server = new ssh2.Server({ hostKeys: [hostKey.private] }, (client) => {
    open++;
    client.on("close", () => open--);
    client.on("error", () => {});
    client.on("authentication", (ctx) => {
      if (ctx.username !== "tunnel") return ctx.reject();
      if (ctx.method === "password" && ctx.password === "secret") return ctx.accept();
      if (ctx.method === "publickey" && ctx.key.data.equals(allowedKey.getPublicSSH())) {
        if (!ctx.signature) return ctx.accept();
        if (allowedKey.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) === true) return ctx.accept();
      }
      ctx.reject(["password", "publickey"]);
    });
    client.on("ready", () => {
      client.on("tcpip", (accept, _reject, info) => {
        forwarded.push(`${info.destIP}:${info.destPort}`);
        const channel = accept();
        const upstream = net.connect(info.destPort, info.destIP);
        channel.pipe(upstream).pipe(channel);
        upstream.on("error", () => channel.close());
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as net.AddressInfo).port,
    forwarded,
    openSessions: () => open,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function connection(sshPort: number, tunnel: Partial<NonNullable<DatabaseConnectionConfig["sshTunnel"]>>) {
  return {
    id: "ssh",
    projectId: "p",
    name: "ssh",
    engine: "postgres",
    // As the SSH server sees it: the database is its own neighbour.
    host: pg.host,
    port: pg.port,
    database: process.env.NEBULADB_TEST_PG_DATABASE || "nebuladb_test",
    user: process.env.NEBULADB_TEST_PG_USER || "nebuladb_test",
    password: process.env.NEBULADB_TEST_PG_PASSWORD || "nebuladb_test",
    sshTunnel: { host: "127.0.0.1", port: sshPort, user: "tunnel", ...tunnel },
  } as DatabaseConnectionConfig;
}

async function open(config: DatabaseConnectionConfig) {
  const { config: target, tunnel } = await reachTarget(config);
  return withTunnel(new PostgresDriver(target), tunnel);
}

async function postgresUp(): Promise<boolean> {
  const driver = new PostgresDriver({ ...connection(1, {}), sshTunnel: undefined });
  try {
    return (await driver.testConnection()).ok;
  } finally {
    await driver.close().catch(() => {});
  }
}

test("SSH tunnel: a password login reaches the database, the host key is reported, closing ends the session", async (t) => {
  if (!(await postgresUp())) return t.skip(`no Postgres test container (${TEST_DB_HINT})`);
  const ssh = await sshServer();
  try {
    const driver = await open(connection(ssh.port, { password: "secret" }));
    const result = await driver.testConnection();
    assert.equal(result.ok, true, result.error ?? "");
    assert.equal(result.sshHostKeyFingerprint, hostFingerprint);
    assert.deepEqual(ssh.forwarded, [`${pg.host}:${pg.port}`]);
    assert.equal(await driver.queryScalar("SELECT 41 + 1"), 42);
    await driver.close();
    for (let i = 0; i < 50 && ssh.openSessions() > 0; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(ssh.openSessions(), 0);
  } finally {
    await ssh.close();
  }
});

test("SSH tunnel: a private key logs in; the pinned host key is enforced", async (t) => {
  if (!(await postgresUp())) return t.skip(`no Postgres test container (${TEST_DB_HINT})`);
  const ssh = await sshServer();
  try {
    const driver = await open(
      connection(ssh.port, { privateKey: clientKey.private, hostKeyFingerprint: hostFingerprint }),
    );
    try {
      assert.equal((await driver.testConnection()).ok, true);
    } finally {
      await driver.close();
    }

    const otherKey = `SHA256:${"A".repeat(43)}`;
    await assert.rejects(
      open(connection(ssh.port, { password: "secret", hostKeyFingerprint: otherKey })),
      (err: unknown) =>
        err instanceof ApiError &&
        err.code === "CONNECTION_SSH_FAILED" &&
        /host key/.test(err.message) &&
        err.details?.sshHostKeyFingerprint === hostFingerprint,
    );
  } finally {
    await ssh.close();
  }
});

test("SSH tunnel: a refused login is an SSH error, and nothing stays open", async () => {
  const ssh = await sshServer();
  try {
    await assert.rejects(
      open(connection(ssh.port, { password: "wrong" })),
      (err: unknown) => err instanceof ApiError && err.code === "CONNECTION_SSH_FAILED",
    );
    for (let i = 0; i < 50 && ssh.openSessions() > 0; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(ssh.openSessions(), 0);
  } finally {
    await ssh.close();
  }
});

test("SSH tunnel: the cloud metadata address is refused as a database behind the tunnel", async () => {
  await assert.rejects(
    reachTarget({ ...connection(22, { password: "x" }), host: "169.254.169.254" }),
    (err: unknown) => err instanceof ApiError && err.code === "CONNECTION_TARGET_FORBIDDEN",
  );
});
