import dns from "node:dns/promises";
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
 * What this does **not** cover, and is not attempting to: DNS-rebinding (the
 * hostname could resolve here to a safe IP and to something else at actual
 * connection time — a TOCTOU gap inherent to checking-then-connecting rather
 * than connecting-and-checking), IPv6 metadata variants beyond the one listed
 * below, and general private-range restriction. A real SSRF hardening pass
 * (network allowlisting the roadmap named as a prerequisite for Phase 27)
 * is still owed — this closes the one gap with no legitimate-use tension.
 */
const BLOCKED_HOSTS = new Set([
  "169.254.169.254", // AWS / GCP / Azure / DigitalOcean instance metadata
  "169.254.170.2", // AWS ECS task metadata
  "metadata.google.internal",
  "metadata.google.internal.",
]);

/** fd00:ec2::254 is AWS's IPv6 metadata address, in its one canonical expanded form dns/net APIs return. */
const BLOCKED_IPV6 = "fd00:ec2::254";

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
