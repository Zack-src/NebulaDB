import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import net, { type LookupFunction } from "node:net";
import { ApiError } from "../../shared/errors.js";

/**
 * Blocks the cloud metadata endpoints (all of link-local, IPv4 and IPv6, plus the Alibaba and
 * Azure host addresses), the destinations a "connect to a database" feature never legitimately
 * needs and the most damaging SSRF targets. Addresses are normalized first, so an IPv4-mapped
 * IPv6 notation (`::ffff:a9fe:a9fe`) is checked as the IPv4 address it reaches.
 *
 * Deliberately not a private-IP blocklist: a self-hosted database is routinely on localhost
 * or a LAN address. The real boundary is who can reach this code (project `administrator`).
 *
 * DNS rebinding is closed by `resolveAllowedHost`: the name is resolved once, every address
 * is checked, and the driver connects to that exact address.
 */
/** Metadata endpoints reached by name. Addresses are in `BLOCKED_RANGES`. */
const BLOCKED_HOSTNAMES = new Set(["metadata.google.internal", "metadata.google.internal."]);

/**
 * Whole ranges, not single addresses: a provider can move its metadata service within
 * link-local, and an IPv6 notation of the same IPv4 address must not slip past a string match.
 */
const BLOCKED_RANGES = new net.BlockList();
BLOCKED_RANGES.addSubnet("169.254.0.0", 16, "ipv4"); // link-local: AWS/GCP/Azure/DO metadata, ECS task metadata
BLOCKED_RANGES.addAddress("100.100.100.200", "ipv4"); // Alibaba Cloud metadata
BLOCKED_RANGES.addAddress("168.63.129.16", "ipv4"); // Azure WireServer / host agent
BLOCKED_RANGES.addSubnet("fe80::", 10, "ipv6"); // IPv6 link-local
BLOCKED_RANGES.addAddress("fd00:ec2::254", "ipv6"); // AWS IPv6 instance metadata

/** Expands an IPv6 literal (zone id dropped, embedded dotted IPv4 allowed) into its 8 groups, or null. */
function ipv6Groups(address: string): number[] | null {
  const bare = address.split("%")[0];
  if (net.isIPv6(bare) === false) return null;
  let text = bare;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted[1].split(".").map(Number);
    text = text.slice(0, -dotted[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split("::");
  const parse = (part: string | undefined) => (part ? part.split(":").map((g) => parseInt(g, 16)) : []);
  const left = parse(head);
  const right = parse(tail);
  const groups = tail === undefined ? left : [...left, ...new Array(8 - left.length - right.length).fill(0), ...right];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

const dotted = (high: number, low: number) => [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");

/**
 * The IPv4 address an IPv6 one carries inside it, for the forms that deliver the packet to that IPv4
 * host: IPv4-mapped (`::ffff:a.b.c.d`), SIIT (`::ffff:0:a.b.c.d`), the NAT64 well-known prefix
 * (`64:ff9b::a.b.c.d`), 6to4 (`2002:aabb:ccdd::`) and the deprecated IPv4-compatible form (`::a.b.c.d`).
 * `::` and `::1` are themselves, not an embedded address.
 */
function embeddedIPv4(groups: number[]): string | null {
  const zeros = (from: number, to: number) => groups.slice(from, to).every((g) => g === 0);
  if (zeros(0, 5) && groups[5] === 0xffff) return dotted(groups[6], groups[7]);
  if (zeros(0, 4) && groups[4] === 0xffff && groups[5] === 0) return dotted(groups[6], groups[7]);
  if (groups[0] === 0x64 && groups[1] === 0xff9b && zeros(2, 6)) return dotted(groups[6], groups[7]);
  if (groups[0] === 0x2002) return dotted(groups[1], groups[2]);
  if (zeros(0, 6) && (groups[6] !== 0 || groups[7] > 1)) return dotted(groups[6], groups[7]);
  return null;
}

/**
 * The canonical form of an IP literal: lower-case, no brackets or zone id, and an
 * IPv4-mapped IPv6 address (`::ffff:169.254.169.254`, `::ffff:a9fe:a9fe`, expanded forms)
 * turned back into the IPv4 address a dual-stack socket actually reaches. Anything that
 * isn't an IP literal comes back trimmed and lower-cased.
 */
export function normalizeAddress(address: string): string {
  const text = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (net.isIPv4(text)) return text;
  const groups = ipv6Groups(text);
  if (!groups) return text;
  const embedded = embeddedIPv4(groups);
  if (embedded) return embedded;
  return text.split("%")[0];
}

/** Whether `address` (an IP literal, in any notation) falls in a blocked range. */
function inBlockedRange(address: string): boolean {
  const normalized = normalizeAddress(address);
  const family = net.isIP(normalized);
  if (family === 4) return BLOCKED_RANGES.check(normalized, "ipv4");
  if (family === 6) return BLOCKED_RANGES.check(normalized, "ipv6");
  return false;
}

/**
 * The same check, for a single resolved address — what a connection-time
 * `lookup` hook uses (see `webhooks/delivery.ts`), which checks the address
 * actually being connected to and so has no DNS-rebinding gap. Also accepts
 * the metadata host names, so a caller can pass a host as typed.
 */
export function isBlockedAddress(address: string): boolean {
  return BLOCKED_HOSTNAMES.has(normalizeAddress(address)) || inBlockedRange(address);
}

export async function assertHostAllowed(host: string | undefined): Promise<void> {
  if (!host) return;
  const trimmed = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (isBlockedAddress(trimmed)) throw forbidden();

  // Resolve and re-check: a hostname (not a literal IP) could point at the
  // metadata address without the string itself ever mentioning it.
  try {
    const records = await dnsPromises.lookup(trimmed, { all: true });
    for (const { address } of records) {
      if (isBlockedAddress(address)) throw forbidden();
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
  if (isBlockedAddress(hostname)) throw forbidden();
  if (net.isIP(hostname.split("%")[0])) return { hostname, address: hostname };

  let records: { address: string }[];
  try {
    records = await dnsPromises.lookup(hostname, { all: true });
  } catch {
    return null;
  }
  if (records.some(({ address }) => isBlockedAddress(address))) throw forbidden();
  return records.length > 0 ? { hostname, address: records[0].address } : null;
}

/**
 * A `lookup` for `http`/`https`/`net` agents that refuses a blocked address at connect time —
 * the address actually dialled is the one checked, so DNS rebinding has no gap. Used by
 * webhook delivery and by the S3 backup destination.
 */
export const guardedLookup: LookupFunction = lookupRefusing(isBlockedAddress);

/**
 * A `lookup` hook that fails with `EBLOCKED` when any resolved address matches `refuse` —
 * `guardedLookup` with a caller's own, stricter rule (webhooks' optional private-network block).
 */
export function lookupRefusing(refuse: (address: string, hostname: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, "", 4);
      const list = addresses as dns.LookupAddress[];
      const blocked = list.find((entry) => refuse(entry.address, hostname));
      if (blocked) {
        return callback(
          Object.assign(new Error(`refusing to connect to ${blocked.address}`), { code: "EBLOCKED" }),
          "",
          4,
        );
      }
      if (options.all) return callback(null, list as unknown as string, 4);
      return callback(null, list[0].address, list[0].family);
    });
  };
}
