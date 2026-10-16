import tls from "node:tls";
import type { DriverConnectionConfig } from "./interface.js";

/**
 * The TLS options every network driver connects with, from the connection's
 * own settings: its authority, its client certificate, and whether the
 * server's certificate is checked. `undefined` when the connection does not
 * use TLS.
 *
 * The socket often targets an address rather than the name the user typed
 * (DNS pinning, an SSH tunnel's local end), so the certificate is checked
 * against `tlsHost` — that name — rather than against the address.
 */
export function driverTlsOptions(config: DriverConnectionConfig): tls.ConnectionOptions | undefined {
  if (!config.ssl) return undefined;
  const verify = config.tlsVerify ?? config.sslVerify ?? false;
  const options: tls.ConnectionOptions = { rejectUnauthorized: verify };
  if (config.sslCa?.trim()) options.ca = config.sslCa;
  if (config.sslCert?.trim()) options.cert = config.sslCert;
  if (config.sslKey?.trim()) options.key = config.sslKey;
  if (config.tlsServerName) options.servername = config.tlsServerName;
  const host = config.tlsHost;
  if (verify && host) options.checkServerIdentity = (_name, cert) => tls.checkServerIdentity(host, cert);
  return options;
}
