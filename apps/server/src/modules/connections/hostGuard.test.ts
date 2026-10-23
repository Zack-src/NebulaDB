import { test } from "node:test";
import assert from "node:assert/strict";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

// `ApiError` records what it reports, through NebulaDB's own database.
await useTestDatabase("hostguard");
const { assertHostAllowed, isBlockedAddress, normalizeAddress, resolveAllowedHost } = await import("./hostGuard.js");

test("normalizeAddress turns IPv4-mapped IPv6 back into IPv4, in every notation", () => {
  assert.equal(normalizeAddress("::ffff:169.254.169.254"), "169.254.169.254");
  assert.equal(normalizeAddress("::ffff:a9fe:a9fe"), "169.254.169.254");
  assert.equal(normalizeAddress("[::FFFF:A9FE:A9FE]"), "169.254.169.254");
  assert.equal(normalizeAddress("0:0:0:0:0:ffff:a9fe:a9fe"), "169.254.169.254");
  assert.equal(normalizeAddress("0000:0000:0000:0000:0000:ffff:169.254.169.254"), "169.254.169.254");
  assert.equal(normalizeAddress("::1"), "::1");
  assert.equal(normalizeAddress("fe80::1%eth0"), "fe80::1");
  assert.equal(normalizeAddress(" DB.Example.com "), "db.example.com");
});

test("isBlockedAddress covers the metadata ranges, whatever the notation", () => {
  for (const address of [
    "169.254.169.254",
    "169.254.170.2",
    "169.254.0.1",
    "169.254.255.255",
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "[::ffff:a9fe:a9fe]",
    "100.100.100.200",
    "::ffff:6464:64c8",
    "168.63.129.16",
    "fe80::1",
    "fe80::1%eth0",
    "febf:ffff::1",
    "fd00:ec2::254",
    "fd00:ec2:0:0:0:0:0:254",
    "metadata.google.internal",
    "Metadata.Google.Internal.",
  ]) {
    assert.equal(isBlockedAddress(address), true, address);
  }
});

test("isBlockedAddress leaves ordinary database hosts alone, private ones included", () => {
  for (const address of [
    "127.0.0.1",
    "::1",
    "10.0.0.5",
    "192.168.1.10",
    "172.16.0.1",
    "fd00::1",
    "fec0::1",
    "100.100.100.201",
    "168.63.129.17",
    "::ffff:10.0.0.5",
    "8.8.8.8",
    "db.example.com",
  ]) {
    assert.equal(isBlockedAddress(address), false, address);
  }
});

test("assertHostAllowed and resolveAllowedHost refuse a mapped metadata address", async () => {
  await assert.rejects(assertHostAllowed("::ffff:a9fe:a9fe"), { code: "CONNECTION_TARGET_FORBIDDEN" });
  await assert.rejects(assertHostAllowed("[::ffff:169.254.169.254]"), { code: "CONNECTION_TARGET_FORBIDDEN" });
  await assert.rejects(resolveAllowedHost("[::ffff:a9fe:a9fe]"), { code: "CONNECTION_TARGET_FORBIDDEN" });
  await assert.rejects(resolveAllowedHost("168.63.129.16"), { code: "CONNECTION_TARGET_FORBIDDEN" });
  assert.deepEqual(await resolveAllowedHost("127.0.0.1"), { hostname: "127.0.0.1", address: "127.0.0.1" });
  await assertHostAllowed("10.1.2.3");
});
