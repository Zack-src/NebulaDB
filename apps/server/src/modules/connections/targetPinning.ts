import net from "node:net";
import type { DatabaseConnectionConfig } from "@nebuladb/shared";
import type { DriverConnectionConfig } from "./drivers/interface.js";
import { resolveAllowedHost } from "./hostGuard.js";

/** `sslmode` values that mean "use TLS" in a Postgres URL; all but `no-verify` also verify the certificate, as `pg` does. */
const PG_TLS_MODES = new Set(["require", "prefer", "verify-ca", "verify-full", "no-verify"]);
/** A URL carrying its own certificate material is left untouched: rewriting it would drop those options. */
const PG_CERT_PARAMS = ["sslcert", "sslkey", "sslrootcert"];

function serverName(hostname: string): string | undefined {
  return net.isIP(hostname) ? undefined : hostname;
}

function bracketed(address: string): string {
  return net.isIPv6(address) ? `[${address}]` : address;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** The server named by an ADO-style SQL Server string (`Server=tcp:host,1433;...`). */
function mssqlStringHost(connectionString: string): string | undefined {
  const match = /(?:^|;)\s*(?:server|data source|address|addr|network address)\s*=\s*(?:tcp:)?([^;,\\]+)/i.exec(
    connectionString,
  );
  return match?.[1]?.trim();
}

/** The host of an Oracle EZConnect string (`[tcps://]host[:port]/service`); a full TNS descriptor is searched for `HOST=`. */
function oracleStringHost(connectString: string): string | undefined {
  const tns = /\(\s*host\s*=\s*([^)\s]+)\s*\)/i.exec(connectString);
  if (tns) return tns[1];
  const match = /^(?:tcps?:\/\/)?(\[[^\]]+\]|[^:/?]+)/i.exec(connectString.trim());
  return match?.[1];
}

/**
 * Turns a stored config into the one a driver connects with: each network target is resolved
 * and checked once (`resolveAllowedHost`) and the driver gets that address. Where the target
 * sits inside an opaque connection string, the host is checked but not pinned.
 */
export async function pinConnectionTarget(config: DatabaseConnectionConfig): Promise<DriverConnectionConfig> {
  if (config.engine === "sqlite") return config;

  if (!config.connectionString) {
    const pinned = await resolveAllowedHost(config.host);
    if (!pinned) return config;
    return { ...config, pinnedAddress: pinned.address, tlsServerName: serverName(pinned.hostname) };
  }

  if (config.engine === "mssql") {
    await resolveAllowedHost(mssqlStringHost(config.connectionString));
    return config;
  }
  if (config.engine === "oracle") {
    await resolveAllowedHost(oracleStringHost(config.connectionString));
    return config;
  }

  const url = parseUrl(config.connectionString);
  if (!url) return config;
  const pinned = await resolveAllowedHost(decodeURIComponent(url.hostname));
  if (!pinned || pinned.address === pinned.hostname) return config;

  if (config.engine === "mysql") {
    if (url.searchParams.has("ssl")) return config;
    url.hostname = bracketed(pinned.address);
    return { ...config, connectionString: url.toString() };
  }

  // postgres
  if (PG_CERT_PARAMS.some((param) => url.searchParams.has(param))) return config;
  const sslmode = url.searchParams.get("sslmode")?.toLowerCase();
  const urlWantsTls = (sslmode !== undefined && PG_TLS_MODES.has(sslmode)) || url.searchParams.get("ssl") === "true";
  url.searchParams.delete("sslmode");
  url.searchParams.delete("ssl");
  url.hostname = bracketed(pinned.address);
  return {
    ...config,
    connectionString: url.toString(),
    ssl: Boolean(config.ssl) || urlWantsTls,
    tlsServerName: serverName(pinned.hostname),
    tlsVerify: urlWantsTls && sslmode !== "no-verify",
  };
}
