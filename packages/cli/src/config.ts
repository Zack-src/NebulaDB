import { UsageError, type OptionValues } from "./args.js";

export interface Config {
  /** The instance's address without a trailing slash; a path prefix (an instance behind a reverse proxy) is kept. */
  baseUrl: string;
  apiKey: string;
}

/** `localhost`, `*.localhost`, `127.0.0.0/8` and `::1`: where a key in clear text does not cross a network. */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);
}

/**
 * The instance's address and the key, from the flags and the environment. The key comes from
 * the environment only, so it never shows in a process list or in a shell history.
 */
export function resolveConfig(values: OptionValues, env: Record<string, string | undefined>): Config {
  const rawUrl = (typeof values.url === "string" ? values.url : env.NEBULADB_URL)?.trim();
  if (!rawUrl) throw new UsageError("no instance address: pass --url or set NEBULADB_URL");
  const apiKey = env.NEBULADB_API_KEY?.trim();
  if (!apiKey) throw new UsageError("no API key: set NEBULADB_API_KEY");

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UsageError(`"${rawUrl}" is not an address (expected https://your-instance)`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UsageError("the instance's address must start with https:// (or http:// on localhost)");
  }
  if (url.username || url.password) {
    throw new UsageError("the instance's address must not carry a user name or password");
  }
  if (url.protocol === "http:" && !isLocalHost(url.hostname) && values.insecure !== true) {
    throw new UsageError(
      `refusing to send the API key in clear text to ${url.hostname}: use https://, or pass --insecure if you accept it`,
    );
  }

  return { baseUrl: `${url.origin}${url.pathname.replace(/\/+$/, "")}`, apiKey };
}
