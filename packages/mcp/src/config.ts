export interface Config {
  /** The instance's address without a trailing slash; a path prefix (an instance behind a reverse proxy) is kept. */
  baseUrl: string;
  apiKey: string;
  /** Per-request timeout, in milliseconds. */
  timeoutMs: number;
  /** Cap on the size of any text a tool or resource returns, in characters. */
  maxOutputChars: number;
}

/** The configuration is wrong: the message says what to fix and never contains the key. */
export class ConfigError extends Error {}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_OUTPUT_CHARS = 200_000;

/** `localhost`, `*.localhost`, `127.0.0.0/8` and `::1`: where a key in clear text does not cross a network. */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);
}

function positiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new ConfigError(`${name} must be a positive integer`);
  return value;
}

/** The instance's address and the key, from the environment only (same variables as `@nebuladb/cli`). */
export function resolveConfig(env: Record<string, string | undefined>): Config {
  const rawUrl = env.NEBULADB_URL?.trim();
  if (!rawUrl) throw new ConfigError("no instance address: set NEBULADB_URL");
  const apiKey = env.NEBULADB_API_KEY?.trim();
  if (!apiKey) throw new ConfigError("no API key: set NEBULADB_API_KEY");

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ConfigError(`"${rawUrl}" is not an address (expected https://your-instance)`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError("NEBULADB_URL must start with https:// (or http:// on localhost)");
  }
  if (url.username || url.password) {
    throw new ConfigError("NEBULADB_URL must not carry a user name or password");
  }
  if (url.protocol === "http:" && !isLocalHost(url.hostname) && env.NEBULADB_INSECURE !== "1") {
    throw new ConfigError(
      `refusing to send the API key in clear text to ${url.hostname}: use https://, or set NEBULADB_INSECURE=1 if you accept it`,
    );
  }

  return {
    baseUrl: `${url.origin}${url.pathname.replace(/\/+$/, "")}`,
    apiKey,
    timeoutMs: positiveInt(env.NEBULADB_MCP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, "NEBULADB_MCP_TIMEOUT_MS"),
    maxOutputChars: positiveInt(
      env.NEBULADB_MCP_MAX_OUTPUT_CHARS,
      DEFAULT_MAX_OUTPUT_CHARS,
      "NEBULADB_MCP_MAX_OUTPUT_CHARS",
    ),
  };
}
