import ssh2 from "ssh2";
import type { DatabaseConnectionConfig, SshTunnelConfig, SshTunnelSummary } from "@nebuladb/shared";
import { ApiError } from "../../shared/errors.js";

/** Engines reached over the network, the only ones TLS or a tunnel mean anything for. */
const NETWORK_ENGINES = new Set(["postgres", "mysql", "mssql", "oracle"]);
const MAX_PEM = 64 * 1024;
const FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}=?$/;

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pem(value: unknown): string | undefined {
  const trimmed = text(value);
  if (trimmed === undefined) return undefined;
  if (trimmed.length > MAX_PEM || !trimmed.startsWith("-----BEGIN ")) throw new ApiError("CONNECTION_TLS_INVALID");
  return `${trimmed}\n`;
}

/**
 * Merges what a request sent for TLS and the tunnel onto what is stored, the
 * way the password is: an empty or missing secret keeps the stored one, `null`
 * removes it, and `sshTunnel: null` removes the tunnel. The result is checked
 * against the connection as it will be.
 */
export function mergeSecurity(
  existing: Partial<DatabaseConnectionConfig>,
  updates: Partial<DatabaseConnectionConfig>,
  merged: DatabaseConnectionConfig,
): void {
  const sent = updates as Record<string, unknown>;
  if (sent.sslKey === null) delete merged.sslKey;
  else if (sent.sslKey === undefined || sent.sslKey === "") merged.sslKey = existing.sslKey;

  if (sent.sshTunnel === null) {
    delete merged.sshTunnel;
  } else if (sent.sshTunnel !== undefined) {
    const before = existing.sshTunnel ?? undefined;
    const next = { ...(sent.sshTunnel as object) } as Record<string, unknown>;
    // Same host and user: the secrets that were not sent again are kept.
    const same = before && before.host === next.host && before.user === next.user;
    for (const key of ["password", "privateKey", "passphrase"] as const) {
      if (next[key] === null) delete next[key];
      else if ((next[key] === undefined || next[key] === "") && same && before[key]) next[key] = before[key];
    }
    merged.sshTunnel = next as unknown as SshTunnelConfig;
  }
  normalizeSecurity(merged);
}

/** Checks and tidies the TLS settings and the tunnel in place; throws on anything unusable. */
export function normalizeSecurity(config: Partial<DatabaseConnectionConfig>): void {
  for (const key of ["sslCa", "sslCert", "sslKey"] as const) {
    const value = pem(config[key]);
    if (value === undefined) delete config[key];
    else config[key] = value;
  }
  if (config.sslVerify !== undefined) config.sslVerify = Boolean(config.sslVerify);
  if (config.sslKey && !config.sslCert) throw new ApiError("CONNECTION_TLS_INVALID");

  const tunnel = config.sshTunnel;
  if (!tunnel) {
    delete config.sshTunnel;
    return;
  }
  if (
    typeof tunnel !== "object" ||
    !NETWORK_ENGINES.has(String(config.engine)) ||
    text(config.connectionString) !== undefined
  ) {
    throw new ApiError("CONNECTION_SSH_INVALID");
  }
  const host = text(tunnel.host);
  const user = text(tunnel.user);
  const port = tunnel.port === undefined || tunnel.port === null ? 22 : Number(tunnel.port);
  const password = typeof tunnel.password === "string" && tunnel.password !== "" ? tunnel.password : undefined;
  const privateKey = text(tunnel.privateKey);
  const passphrase = typeof tunnel.passphrase === "string" && tunnel.passphrase !== "" ? tunnel.passphrase : undefined;
  const fingerprint = text(tunnel.hostKeyFingerprint);
  if (!host || !user || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new ApiError("CONNECTION_SSH_INVALID");
  if (!password && !privateKey) throw new ApiError("CONNECTION_SSH_INVALID");
  if (privateKey) {
    if (privateKey.length > MAX_PEM) throw new ApiError("CONNECTION_SSH_INVALID");
    const parsed = ssh2.utils.parseKey(privateKey, passphrase);
    if (parsed instanceof Error)
      throw new ApiError("CONNECTION_SSH_INVALID", { message: `private key: ${parsed.message}` });
  }
  if (fingerprint && !FINGERPRINT.test(fingerprint)) throw new ApiError("CONNECTION_SSH_INVALID");
  config.sshTunnel = {
    host,
    port,
    user,
    ...(password ? { password } : {}),
    ...(privateKey ? { privateKey: `${privateKey}\n` } : {}),
    ...(passphrase ? { passphrase } : {}),
    ...(fingerprint ? { hostKeyFingerprint: fingerprint } : {}),
  };
}

/** What a summary shows of the TLS settings and the tunnel: no key, no password. */
export function securitySummary(config: Partial<DatabaseConnectionConfig>): {
  sslVerify?: boolean;
  sslCa?: string;
  sslCert?: string;
  hasSslKey?: boolean;
  sshTunnel?: SshTunnelSummary;
} {
  const tunnel = config.sshTunnel;
  return {
    ...(config.sslVerify !== undefined ? { sslVerify: config.sslVerify } : {}),
    ...(config.sslCa ? { sslCa: config.sslCa } : {}),
    ...(config.sslCert ? { sslCert: config.sslCert } : {}),
    ...(config.sslKey ? { hasSslKey: true } : {}),
    ...(tunnel
      ? {
          sshTunnel: {
            host: tunnel.host,
            port: tunnel.port ?? 22,
            user: tunnel.user,
            hasPassword: Boolean(tunnel.password),
            hasPrivateKey: Boolean(tunnel.privateKey),
            ...(tunnel.hostKeyFingerprint ? { hostKeyFingerprint: tunnel.hostKeyFingerprint } : {}),
          },
        }
      : {}),
  };
}
