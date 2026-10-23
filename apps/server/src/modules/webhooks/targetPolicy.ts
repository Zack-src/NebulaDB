import dnsPromises from "node:dns/promises";
import net, { type LookupFunction } from "node:net";
import { ApiError } from "../../shared/errors.js";
import { assertHostAllowed, isBlockedAddress, lookupRefusing, normalizeAddress } from "../connections/hostGuard.js";

/**
 * Where a webhook may point, on top of the metadata block every outbound request gets
 * (`connections/hostGuard.ts`). Both rules are instance settings, off by default so an
 * existing install keeps delivering to its LAN receivers:
 *
 * - `NEBULADB_WEBHOOK_ALLOWED_HOSTS` — comma-separated host names (`hooks.example.com`),
 *   wildcards (`*.example.com`, subdomains only), IP addresses or CIDR ranges. When set, a
 *   webhook may only target a listed host. Listed hosts are also exempt from the next rule.
 * - `NEBULADB_WEBHOOK_BLOCK_PRIVATE=1` — refuse loopback, private (RFC 1918, ULA), CGNAT,
 *   link-local, multicast and reserved addresses, checked on the address actually dialled.
 */

const PRIVATE_RANGES = new net.BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  PRIVATE_RANGES.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  PRIVATE_RANGES.addSubnet(network, prefix, "ipv6");
}

/** Loopback, private, link-local, multicast or reserved — after IPv4-mapped normalization. */
export function isPrivateAddress(address: string): boolean {
  const normalized = normalizeAddress(address);
  const family = net.isIP(normalized);
  if (family === 4) return PRIVATE_RANGES.check(normalized, "ipv4");
  if (family === 6) return PRIVATE_RANGES.check(normalized, "ipv6");
  return false;
}

interface AllowList {
  names: string[];
  suffixes: string[];
  addresses: net.BlockList;
  empty: boolean;
}

function allowList(): AllowList {
  const list: AllowList = { names: [], suffixes: [], addresses: new net.BlockList(), empty: true };
  for (const raw of (process.env.NEBULADB_WEBHOOK_ALLOWED_HOSTS ?? "").split(",")) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    list.empty = false;
    const [ip, prefix] = entry.split("/");
    const address = normalizeAddress(ip);
    const family = net.isIP(address);
    if (family) {
      const type = family === 4 ? "ipv4" : "ipv6";
      const bits = prefix === undefined ? (family === 4 ? 32 : 128) : Number(prefix);
      if (Number.isInteger(bits) && bits >= 0 && bits <= (family === 4 ? 32 : 128)) {
        list.addresses.addSubnet(address, bits, type);
      }
    } else if (entry.startsWith("*.")) {
      list.suffixes.push(entry.slice(1));
    } else {
      list.names.push(entry.replace(/\.$/, ""));
    }
  }
  return list;
}

function addressListed(list: AllowList, address: string): boolean {
  const normalized = normalizeAddress(address);
  const family = net.isIP(normalized);
  return family !== 0 && list.addresses.check(normalized, family === 4 ? "ipv4" : "ipv6");
}

function nameListed(list: AllowList, hostname: string): boolean {
  const name = normalizeAddress(hostname).replace(/\.$/, "");
  return list.names.includes(name) || list.suffixes.some((suffix) => name.endsWith(suffix));
}

const blockPrivate = () => process.env.NEBULADB_WEBHOOK_BLOCK_PRIVATE === "1";

/** Whether the host in a webhook URL is one the instance lets webhooks target at all. */
export function isWebhookHostListed(hostname: string): boolean {
  const list = allowList();
  return list.empty || nameListed(list, hostname) || addressListed(list, hostname);
}

/** Whether connecting to `address` (resolved from `hostname`) is refused for a webhook. */
export function isWebhookAddressRefused(address: string, hostname: string): boolean {
  if (isBlockedAddress(address)) return true;
  if (!blockPrivate() || !isPrivateAddress(address)) return false;
  const list = allowList();
  return !nameListed(list, hostname) && !addressListed(list, address);
}

/** The connect-time check for webhook delivery: the address actually dialled is the one judged. */
export const webhookLookup: LookupFunction = lookupRefusing(isWebhookAddressRefused);

function refused(message: string): ApiError {
  return new ApiError("WEBHOOK_URL_INVALID", { message });
}

/**
 * The friendly refusal when a webhook is saved. `deliver` enforces the same rules again at
 * connect time, so a name that resolves elsewhere later gains nothing.
 */
export async function assertWebhookTargetAllowed(hostname: string): Promise<void> {
  await assertHostAllowed(hostname);
  const host = hostname.replace(/^\[|\]$/g, "");
  if (!isWebhookHostListed(host)) throw refused("this host is not in the instance's webhook allow-list");
  if (!blockPrivate()) return;
  const privateTarget = "webhooks to private or loopback addresses are disabled on this instance";
  if (net.isIP(host)) {
    if (isWebhookAddressRefused(host, host)) throw refused(privateTarget);
    return;
  }
  let records: { address: string }[];
  try {
    records = await dnsPromises.lookup(host, { all: true });
  } catch {
    return; // Unresolvable now: delivery will fail (or be refused) on its own.
  }
  if (records.some(({ address }) => isWebhookAddressRefused(address, host))) throw refused(privateTarget);
}
