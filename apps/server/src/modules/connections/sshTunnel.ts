import crypto from "node:crypto";
import net from "node:net";
import ssh2 from "ssh2";
import type { DatabaseConnectionConfig, SshTunnelConfig } from "@nebuladb/shared";
import { ApiError } from "../../shared/errors.js";
import type { DriverConnectionConfig } from "./drivers/interface.js";
import { isBlockedAddress, resolveAllowedHost } from "./hostGuard.js";
import { pinConnectionTarget } from "./targetPinning.js";

const READY_TIMEOUT_MS = 10_000;

const DEFAULT_PORTS: Record<string, number> = { postgres: 5432, mysql: 3306, mssql: 1433, oracle: 1521 };

export interface OpenTunnel {
  /** Where the driver connects: a port on 127.0.0.1 forwarded to the database through the SSH server. */
  localPort: number;
  /** The SSH server's host key, as `ssh-keygen -lf` prints it. */
  hostKeyFingerprint: string;
  close(): Promise<void>;
}

/** `SHA256:` and the unpadded base64 of the key's SHA-256 — OpenSSH's own spelling. */
export function hostKeyFingerprint(key: Buffer): string {
  return `SHA256:${crypto.createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}

function failed(message: string, fingerprint?: string): ApiError {
  return new ApiError("CONNECTION_SSH_FAILED", {
    message: `SSH ${message}`,
    ...(fingerprint ? { details: { sshHostKeyFingerprint: fingerprint } } : {}),
  });
}

/**
 * Logs in to the SSH server and listens on a free local port; every socket
 * accepted there is forwarded to `target` from the SSH server's side. The SSH
 * server is resolved and checked like any database host; the target is
 * resolved by the SSH server, so only its literal name can be checked here.
 */
export async function openSshTunnel(
  tunnel: SshTunnelConfig,
  target: { host: string; port: number },
): Promise<OpenTunnel> {
  if (isBlockedAddress(target.host)) throw new ApiError("CONNECTION_TARGET_FORBIDDEN");
  const pinned = await resolveAllowedHost(tunnel.host);
  const client = new ssh2.Client();
  let seen = "";
  let mismatch = false;

  await new Promise<void>((resolve, reject) => {
    const fail = (err: Error) => {
      client.end();
      reject(
        mismatch
          ? failed(`host key ${seen} is not the expected ${tunnel.hostKeyFingerprint}`, seen)
          : failed(`${tunnel.host}:${tunnel.port ?? 22}: ${err.message}`, seen || undefined),
      );
    };
    client.once("ready", () => {
      client.removeListener("error", fail);
      resolve();
    });
    client.once("error", fail);
    client.connect({
      host: pinned?.address ?? tunnel.host,
      port: tunnel.port ?? 22,
      username: tunnel.user,
      password: tunnel.password,
      privateKey: tunnel.privateKey,
      passphrase: tunnel.passphrase,
      readyTimeout: READY_TIMEOUT_MS,
      keepaliveInterval: 15_000,
      hostVerifier: (key: Buffer) => {
        seen = hostKeyFingerprint(key);
        mismatch = Boolean(tunnel.hostKeyFingerprint) && tunnel.hostKeyFingerprint !== seen;
        return !mismatch;
      },
    });
  });

  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    client.forwardOut("127.0.0.1", socket.remotePort ?? 0, target.host, target.port, (err, stream) => {
      if (err) {
        socket.destroy(err);
        return;
      }
      socket.pipe(stream).pipe(socket);
      stream.once("close", () => socket.destroy());
      socket.once("error", () => stream.close());
    });
  });
  const close = async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    client.end();
  };
  // The SSH session dropping takes the tunnel with it: new sockets would hang.
  client.on("error", () => void close().catch(() => {}));
  client.once("close", () => void close().catch(() => {}));

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
  } catch (err) {
    client.end();
    throw err;
  }
  return { localPort: (server.address() as net.AddressInfo).port, hostKeyFingerprint: seen, close };
}

/**
 * Where a network driver connects: the pinned address of the database, or —
 * when the connection goes through SSH — the local end of a tunnel, the
 * database's own name kept for TLS.
 */
export async function reachTarget(
  config: DatabaseConnectionConfig,
): Promise<{ config: DriverConnectionConfig; tunnel: OpenTunnel | null }> {
  if (!config.sshTunnel || config.connectionString) return { config: await pinConnectionTarget(config), tunnel: null };
  const host = config.host?.trim() || "localhost";
  const tunnel = await openSshTunnel(config.sshTunnel, { host, port: config.port || DEFAULT_PORTS[config.engine] });
  // First connection of a saved connection: remember the key, so a changed one is refused from now on.
  if (config.id && !config.sshTunnel.hostKeyFingerprint && tunnel.hostKeyFingerprint) {
    const { pinSshHostKey } = await import("./repository.js");
    await pinSshHostKey(config.id, tunnel.hostKeyFingerprint).catch(() => {});
  }
  return {
    config: {
      ...config,
      pinnedAddress: "127.0.0.1",
      port: tunnel.localPort,
      tlsHost: host,
      tlsServerName: net.isIP(host) ? undefined : host,
    },
    tunnel,
  };
}

/** Closes the tunnel with the driver, and lets a connection test say which host key answered. */
export function withTunnel<T extends { close(): Promise<void>; testConnection?(): Promise<object> }>(
  driver: T,
  tunnel: OpenTunnel | null,
): T {
  if (!tunnel) return driver;
  const close = driver.close.bind(driver);
  driver.close = async () => {
    try {
      await close();
    } finally {
      await tunnel.close();
    }
  };
  const test = driver.testConnection?.bind(driver);
  if (test)
    driver.testConnection = async () => ({ ...(await test()), sshHostKeyFingerprint: tunnel.hostKeyFingerprint });
  return driver;
}
