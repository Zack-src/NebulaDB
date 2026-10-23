import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { PostgresDriver } from "./postgres.js";
import type { DriverConnectionConfig } from "./interface.js";
import { driverTlsOptions } from "./tls.js";
import { TEST_DB_HINT } from "./testDbAvailability.js";

const fixtures = fileURLToPath(new URL("../../../../test-fixtures/tls/", import.meta.url));
const read = (name: string) => fs.readFileSync(fixtures + name, "utf8");
const ca = read("ca.crt");
const clientCert = read("client.crt");
const clientKey = read("client.key");

const target = {
  host: process.env.NEBULADB_TEST_PG_HOST || "localhost",
  port: Number(process.env.NEBULADB_TEST_PG_PORT || 55432),
};

/**
 * The test PostgreSQL does not speak TLS, so this stands in front of it: it
 * answers PostgreSQL's SSLRequest with "yes", does the TLS handshake with the
 * fixture certificate, then passes the bytes through to the real server.
 */
async function tlsFrontOfPostgres(options: { requestCert?: boolean } = {}) {
  let handshakes = 0;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("data", (first: Buffer) => {
      // 8 bytes: length, then 80877103 — the SSLRequest code.
      if (first.length !== 8 || first.readInt32BE(4) !== 80877103) return socket.destroy();
      socket.write("S");
      const secure = new tls.TLSSocket(socket, {
        isServer: true,
        key: read("server.key"),
        cert: read("server.crt"),
        ca,
        requestCert: options.requestCert ?? false,
        rejectUnauthorized: options.requestCert ?? false,
      });
      secure.once("secure", () => {
        handshakes++;
        const upstream = net.connect(target.port, target.host);
        sockets.add(upstream);
        secure.pipe(upstream).pipe(secure);
        upstream.on("error", () => secure.destroy());
      });
      secure.on("error", () => socket.destroy());
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as net.AddressInfo).port,
    handshakes: () => handshakes,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function configFor(port: number, extra: Partial<DriverConnectionConfig>): DriverConnectionConfig {
  return {
    id: "tls",
    projectId: "p",
    name: "tls",
    engine: "postgres",
    host: "localhost",
    port,
    database: process.env.NEBULADB_TEST_PG_DATABASE || "nebuladb_test",
    user: process.env.NEBULADB_TEST_PG_USER || "nebuladb_test",
    password: process.env.NEBULADB_TEST_PG_PASSWORD || "nebuladb_test",
    ssl: true,
    // As `pinConnectionTarget` leaves it: the socket goes to the address, the name is kept for the certificate.
    pinnedAddress: "127.0.0.1",
    tlsServerName: "localhost",
    tlsHost: "localhost",
    ...extra,
  };
}

async function attempt(config: DriverConnectionConfig) {
  const driver = new PostgresDriver(config);
  try {
    return await driver.testConnection();
  } finally {
    await driver.close().catch(() => {});
  }
}

async function postgresUp(): Promise<boolean> {
  const plain = new PostgresDriver({ ...configFor(target.port, { ssl: false }), pinnedAddress: undefined });
  try {
    return (await plain.testConnection()).ok;
  } finally {
    await plain.close().catch(() => {});
  }
}

test("TLS options: nothing without ssl, the authority and the client pair when given", () => {
  assert.equal(driverTlsOptions(configFor(1, { ssl: false })), undefined);
  const plain = driverTlsOptions(configFor(1, {}))!;
  assert.equal(plain.rejectUnauthorized, true);
  assert.equal(driverTlsOptions(configFor(1, { sslVerify: false }))!.rejectUnauthorized, false);
  assert.equal(plain.ca, undefined);
  const full = driverTlsOptions(configFor(1, { sslVerify: true, sslCa: ca, sslCert: clientCert, sslKey: clientKey }))!;
  assert.equal(full.rejectUnauthorized, true);
  assert.equal(full.ca, ca);
  assert.equal(full.cert, clientCert);
  assert.equal(full.key, clientKey);
  // A Postgres URL's own sslmode wins over the stored setting.
  assert.equal(driverTlsOptions(configFor(1, { sslVerify: true, tlsVerify: false }))!.rejectUnauthorized, false);
});

test("PostgreSQL over TLS: the server's certificate is checked against the connection's own authority", async (t) => {
  if (!(await postgresUp())) return t.skip(`no Postgres test container (${TEST_DB_HINT})`);
  const front = await tlsFrontOfPostgres();
  try {
    const trusted = await attempt(configFor(front.port, { sslVerify: true, sslCa: ca }));
    assert.equal(trusted.ok, true, trusted.error ?? "");
    assert.equal(front.handshakes(), 1);

    // The system authorities do not know the test one.
    const unknown = await attempt(configFor(front.port, { sslVerify: true }));
    assert.equal(unknown.ok, false);
    assert.match(unknown.error ?? "", /self.signed|unable to (get|verify)/i);

    // Signed by the right authority, but for another name.
    const misnamed = await attempt(configFor(front.port, { sslVerify: true, sslCa: ca, tlsHost: "db.example.com" }));
    assert.equal(misnamed.ok, false);
    assert.match(misnamed.error ?? "", /altnames|does not match/i);

    // Without the check, as before: encrypted, whoever signed it.
    const unchecked = await attempt(configFor(front.port, {}));
    assert.equal(unchecked.ok, true, unchecked.error ?? "");
  } finally {
    await front.close();
  }
});

test("PostgreSQL over TLS: a server asking for a client certificate gets the connection's", async (t) => {
  if (!(await postgresUp())) return t.skip(`no Postgres test container (${TEST_DB_HINT})`);
  const front = await tlsFrontOfPostgres({ requestCert: true });
  try {
    const withPair = await attempt(
      configFor(front.port, { sslVerify: true, sslCa: ca, sslCert: clientCert, sslKey: clientKey }),
    );
    assert.equal(withPair.ok, true, withPair.error ?? "");
    const without = await attempt(configFor(front.port, { sslVerify: true, sslCa: ca }));
    assert.equal(without.ok, false);
  } finally {
    await front.close();
  }
});
