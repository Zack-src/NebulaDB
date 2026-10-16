import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import net from "node:net";
import ssh2 from "ssh2";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

await useTestDatabase("connsecurityroutes");
process.env.NEBULADB_COOKIE_SECURE = "false";
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
process.env.NEBULADB_LOG_LEVEL = "silent";

const { buildApp } = await import("../../app.js");
const { db } = await import("../../infrastructure/db.js");
const { hashPassword } = await import("../auth/password.js");
const { closeAllRooms } = await import("../../realtime/roomRegistry.js");
const { getConnectionById } = await import("./repository.js");
const { hostKeyFingerprint } = await import("./sshTunnel.js");

const HOST = "localhost:3001";
const headers = (extra: Record<string, string> = {}) => ({ host: HOST, origin: `http://${HOST}`, ...extra });
const PASSWORD = "correct horse battery staple";

const app = await buildApp();
after(async () => {
  closeAllRooms();
  await app.close();
});

async function adminCookie() {
  const email = `${randomUUID()}@example.com`;
  await db
    .prepare("INSERT INTO users (id, email, password_hash, is_admin) VALUES (?, ?, ?, 1)")
    .run(randomUUID(), email, await hashPassword(PASSWORD));
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: headers(),
    payload: { email, password: PASSWORD },
  });
  return `nebuladb_sid=${res.cookies.find((c) => c.name === "nebuladb_sid")!.value}`;
}

const CA = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
const KEY = "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----";

test("admin connections: TLS and SSH settings are stored encrypted, shown without their secrets, kept on edit", async () => {
  const cookie = await adminCookie();
  const created = await app.inject({
    method: "POST",
    url: "/api/admin/connections",
    headers: headers({ cookie }),
    payload: {
      name: "Behind a bastion",
      engine: "postgres",
      host: "db.internal",
      port: 5432,
      database: "shop",
      user: "app",
      password: "db-password",
      ssl: true,
      sslVerify: true,
      sslCa: CA,
      sslCert: CA,
      sslKey: KEY,
      sshTunnel: { host: "bastion.example.com", user: "deploy", password: "ssh-password" },
    },
  });
  assert.equal(created.statusCode, 200, created.body);
  const connection = created.json().connection;
  assert.equal(created.body.includes("ssh-password"), false);
  assert.equal(created.body.includes("PRIVATE KEY"), false);
  assert.equal(connection.sslVerify, true);
  assert.equal(connection.sslCa, `${CA}\n`);
  assert.equal(connection.hasSslKey, true);
  assert.deepEqual(connection.sshTunnel, {
    host: "bastion.example.com",
    port: 22,
    user: "deploy",
    hasPassword: true,
    hasPrivateKey: false,
  });
  const row = (await db.prepare("SELECT config_encrypted FROM db_connections WHERE id = ?").get(connection.id)) as {
    config_encrypted: string;
  };
  assert.equal(row.config_encrypted.includes("ssh-password"), false);

  // The form sends back what it was shown, the port changed.
  const edited = await app.inject({
    method: "PUT",
    url: `/api/admin/connections/${connection.id}`,
    headers: headers({ cookie }),
    payload: { sslKey: "", sshTunnel: { host: "bastion.example.com", port: 2222, user: "deploy" } },
  });
  assert.equal(edited.statusCode, 200, edited.body);
  const stored = (await getConnectionById(connection.id))!;
  assert.equal(stored.sshTunnel?.password, "ssh-password");
  assert.equal(stored.sshTunnel?.port, 2222);
  assert.equal(stored.sslKey, `${KEY}\n`);

  // Removing the tunnel; then a tunnel is refused on a connection string.
  const removed = await app.inject({
    method: "PUT",
    url: `/api/admin/connections/${connection.id}`,
    headers: headers({ cookie }),
    payload: { sshTunnel: null },
  });
  assert.equal(removed.json().connection.sshTunnel, undefined);
  const refused = await app.inject({
    method: "POST",
    url: "/api/admin/connections",
    headers: headers({ cookie }),
    payload: {
      name: "String",
      engine: "postgres",
      connectionString: "postgres://u:p@db/x",
      sshTunnel: { host: "b", user: "u", password: "p" },
    },
  });
  assert.equal(refused.statusCode, 400);
  assert.equal(refused.json().code, "CONNECTION_SSH_INVALID");
});

test("admin connection test: an SSH server that refuses is an answer, with the host key that answered", async () => {
  const cookie = await adminCookie();
  const hostKey = ssh2.utils.generateKeyPairSync("ed25519");
  const server = new ssh2.Server({ hostKeys: [hostKey.private] }, (client) => {
    client.on("error", () => {});
    client.on("authentication", (ctx) => ctx.reject(["password"]));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/connections/test",
      headers: headers({ cookie }),
      payload: {
        engine: "postgres",
        host: "db.internal",
        port: 5432,
        user: "app",
        password: "x",
        sshTunnel: {
          host: "127.0.0.1",
          port: (server.address() as net.AddressInfo).port,
          user: "deploy",
          password: "wrong",
        },
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    const result = res.json();
    assert.equal(result.ok, false);
    assert.match(result.error, /^SSH /);
    const expected = hostKeyFingerprint((ssh2.utils.parseKey(hostKey.public) as ssh2.ParsedKey).getPublicSSH());
    assert.equal(result.sshHostKeyFingerprint, expected);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
