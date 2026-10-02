import dns from "node:dns/promises";
import net from "node:net";
import { ApiError } from "../../shared/errors.js";

/**
 * Blocks the server from being pointed at the cloud provider metadata
 * endpoint — the one network destination a "connect to a database" feature
 * has zero legitimate reason to ever reach, and the single most damaging
 * SSRF target there is (it hands back the *host's* cloud credentials, not
 * anything belonging to this app).
 *
 * Deliberately narrow, not a general private-IP blocklist: unlike a
 * multi-tenant SaaS, a self-hosted deployment's own database is routinely on
 * `localhost`, a docker-compose service name, or a private LAN address —
 * blocking those by default would break the feature for the exact case it
 * was built for. The real boundary this relies on instead is *who* can reach
 * this code at all: every route in `routes.ts` requires project
 * `administrator`, not just `edit` — see the routes file for that reasoning.
 *
 * DNS rebinding is closed by `resolveAllowedHost`: the name is resolved once,
 * every address is checked, and the driver then connects to that exact
 * address instead of resolving the name a second time. What this still does
 * **not** attempt: IPv6 metadata variants beyond the one listed below, and
 * general private-range restriction.
 */
const BLOCKED_HOSTS = new Set([
  "169.254.169.254", // AWS / GCP / Azure / DigitalOcean instance metadata
  "169.254.170.2", // AWS ECS task metadata
  "metadata.google.internal",
  "metadata.google.internal.",
]);

/** fd00:ec2::254 is AWS's IPv6 metadata address, in its one canonical expanded form dns/net APIs return. */
const BLOCKED_IPV6 = "fd00:ec2::254";

/**
 * The same check, for a single resolved address — what a connection-time
 * `lookup` hook uses (see `webhooks/delivery.ts`), which checks the address
 * actually being connected to and so has no DNS-rebinding gap.
 */
export function isBlockedAddress(address: string): boolean {
  const normalized = address
    .trim()
    .toLowerCase()
    .replace(/^::ffff:/, "");
  return BLOCKED_HOSTS.has(normalized) || normalized === BLOCKED_IPV6;
}

export async function assertHostAllowed(host: string | undefined): Promise<void> {
  if (!host) return;
  const trimmed = host.trim().toLowerCase();
  if (BLOCKED_HOSTS.has(trimmed) || trimmed === BLOCKED_IPV6) {
    throw new ApiError("CONNECTION_TARGET_FORBIDDEN", {
      message: "connections to the cloud provider metadata endpoint are not allowed",
    });
  }

  // Resolve and re-check: a hostname (not a literal IP) could point at the
  // metadata address without the string itself ever mentioning it.
  try {
    const records = await dns.lookup(trimmed, { all: true });
    for (const { address } of records) {
      if (BLOCKED_HOSTS.has(address) || address === BLOCKED_IPV6) {
        throw new ApiError("CONNECTION_TARGET_FORBIDDEN", {
          message: "connections to the cloud provider metadata endpoint are not allowed",
        });
      }
    }
  } catch (err) {
    // A lookup failure (unresolvable host, no network) isn't this guard's
    // concern — let the driver's own connection attempt fail with its own,
    // more specific error instead of masking it here. Only re-throw our own
    // rejection.
    if (err instanceof ApiError) throw err;
  }
}

export interface PinnedHost {
  /** What the caller typed — still the right name for TLS (SNI, certificate check). */
  hostname: string;
  /** The address that was checked, and the only one the driver may connect to. */
  address: string;
}

function forbidden(): ApiError {
  return new ApiError("CONNECTION_TARGET_FORBIDDEN", {
    message: "connections to the cloud provider metadata endpoint are not allowed",
  });
}

/**
 * Resolve-once-then-connect: returns the address the driver must use, so the
 * name can't answer with a safe IP here and the metadata endpoint a moment
 * later. `null` when the name doesn't resolve — the driver's own attempt then
 * fails with its own, more specific error.
 */
export async function resolveAllowedHost(host: string | undefined): Promise<PinnedHost | null> {
  if (!host) return null;
  const hostname = host.trim().replace(/^\[|\]$/g, "");
  if (!hostname) return null;
  if (isBlockedAddress(hostname) || BLOCKED_HOSTS.has(hostname.toLowerCase())) throw forbidden();
  if (net.isIP(hostname)) return { hostname, address: hostname };

  let records: { address: string }[];
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    return null;
  }
  if (records.some(({ address }) => isBlockedAddress(address))) throw forbidden();
  return records.length > 0 ? { hostname, address: records[0].address } : null;
}
