import { test } from "node:test";
import assert from "node:assert/strict";
import { useTestDatabase } from "./infrastructure/testDatabase.js";
import { projectToSvg } from "@nebuladb/dbml-engine";

await useTestDatabase("securityprobes");
process.env.NEBULADB_SECRET = "test-secret-do-not-use-in-production";
const { encryptPayload, decryptPayload } = await import("./shared/crypto.js");
const { normalizeAddress, isBlockedAddress } = await import("./modules/connections/hostGuard.js");
const { isPrivateAddress } = await import("./modules/webhooks/targetPolicy.js");
const { redactShareTokens } = await import("./shared/logRedaction.js");

// ---- SVG export: whatever a collaborator writes into the document, the file stays inert --------------

const HOSTILE = `"/><script>alert(1)</script><rect x="`;
const HOSTILE_VALUES: unknown[] = [
  HOSTILE,
  "1e999",
  NaN,
  Infinity,
  -Infinity,
  {},
  [],
  null,
  undefined,
  "javascript:alert(1)",
  `'><img src=x onerror=alert(1)>`,
  "]]>",
  "&#x3C;script&#x3E;",
];

/** True when `svg` is well-formed enough that nothing outside text and quoted attribute values can be an element. */
function inert(svg: string): string | null {
  if (/<script/i.test(svg)) return "contains <script";
  // Inside a tag only: in escaped text, `onerror=` is just letters.
  if ((svg.match(/<[^>]*>/g) ?? []).some((tagText) => /\son[a-z]+\s*=/i.test(tagText))) {
    return "contains an event handler attribute";
  }
  if (/<(foreignObject|iframe|object|embed|a\b|image|use\b|style\b)/i.test(svg)) return "contains an active element";
  const tag = /<\/?[A-Za-z][\w:-]*(?:\s+[\w:-]+="[^"<]*")*\s*\/?>/g;
  const leftover = svg.replace(tag, "").replace(/<\?xml[^>]*\?>/, "");
  if (/[<]/.test(leftover)) return `a "<" outside any well-formed tag: ${leftover.match(/.{0,30}<.{0,30}/)?.[0]}`;
  return null;
}

function projectWith(value: unknown) {
  const table = (id: string) => ({
    id,
    name: value,
    schemaName: value,
    note: value,
    fields: [{ id: "f1", name: value, type: value, note: value, default: value, pk: true }],
    indexes: [],
    position: { x: value, y: value },
    size: { width: value, height: value },
    style: { color: value, headerColor: value },
    detailLevel: "full",
  });
  return {
    id: "p",
    name: value,
    tables: [table("t1"), table("t2")],
    refs: [
      {
        id: "r1",
        name: value,
        from: { tableId: "t1", fieldId: "f1" },
        to: { tableId: "t2", fieldId: "f1" },
        cardinality: value,
        style: { color: value },
        routingPoints: [{ x: value, y: value }],
      },
    ],
    enums: [],
    zones: [],
    stickyNotes: [],
    groups: [],
  } as never;
}

test("the SVG export stays inert whatever is written into any field of the document", () => {
  const problems: string[] = [];
  for (const value of HOSTILE_VALUES) {
    let svg: string;
    try {
      svg = projectToSvg(projectWith(value));
    } catch (err) {
      problems.push(
        `${String(value).slice(0, 30)}: threw ${(err as Error).stack?.split("\n").slice(0, 3).join(" | ")}`,
      );
      continue;
    }
    const reason = inert(svg);
    if (reason) problems.push(`${typeof value} ${String(JSON.stringify(value)).slice(0, 40)}: ${reason}`);
    // In an attribute (a coordinate, a size) such a word would break the drawing; as escaped text it is only a word.
    if ((svg.match(/<[^>]*>/g) ?? []).some((tagText) => /NaN|Infinity|undefined|\[object/.test(tagText))) {
      problems.push(`${String(JSON.stringify(value))}: a JS value leaks into an attribute`);
    }
  }
  assert.deepEqual(problems, []);
});

// ---- Addresses: no notation of a forbidden host gets past the guards -------------------------------

const METADATA_FORMS = [
  "169.254.169.254",
  "::ffff:169.254.169.254",
  "::ffff:a9fe:a9fe",
  "0:0:0:0:0:ffff:a9fe:a9fe",
  "[::ffff:a9fe:a9fe]",
  "::FFFF:A9FE:A9FE",
  "169.254.0.1",
  "fe80::1",
  "FE80::1%eth0",
  "fd00:ec2::254",
  "100.100.100.200",
  "168.63.129.16",
  "metadata.google.internal",
  "metadata.google.internal.",
  "METADATA.GOOGLE.INTERNAL",
];

test("every spelling of a cloud metadata address is blocked", () => {
  const passed = METADATA_FORMS.filter((address) => !isBlockedAddress(address));
  assert.deepEqual(passed, []);
});

const TRANSLATED_METADATA = [
  // These reach 169.254.169.254 through a NAT64 or tunnel gateway, on networks that have one.
  "64:ff9b::a9fe:a9fe",
  "64:ff9b::169.254.169.254",
  "2002:a9fe:a9fe::1",
  "::169.254.169.254",
  "::ffff:0:a9fe:a9fe",
];

test("addresses that embed the metadata IPv4 address (NAT64, 6to4, IPv4-compatible, SIIT) are blocked", () => {
  const passed = TRANSLATED_METADATA.filter((address) => !isBlockedAddress(address));
  assert.deepEqual(passed, [], "these reach the metadata service on a host with a NAT64 or tunnel route");
});

const PRIVATE_FORMS = [
  "127.0.0.1",
  "127.1.2.3",
  "10.0.0.1",
  "172.16.0.1",
  "172.31.255.255",
  "192.168.1.1",
  "0.0.0.0",
  "::1",
  "::",
  "::ffff:127.0.0.1",
  "::ffff:7f00:1",
  "::ffff:10.0.0.1",
  "fc00::1",
  "fd12:3456::1",
  "fe80::1",
  "100.64.0.1",
  "192.0.0.1",
  "198.18.0.1",
  "224.0.0.1",
  "255.255.255.255",
  ...TRANSLATED_METADATA,
  "64:ff9b::7f00:1",
  "64:ff9b::a00:1",
  "::127.0.0.1",
  "2002:7f00:1::1",
];

test("every spelling of a private or loopback address is recognised as private", () => {
  const passed = PRIVATE_FORMS.filter((address) => !isPrivateAddress(address));
  assert.deepEqual(passed, []);
});

test("public addresses are not taken for private ones", () => {
  const wrong = [
    "8.8.8.8",
    "1.1.1.1",
    "172.15.0.1",
    "172.32.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "2606:4700::1111",
    "64:ff9b::808:808",
    "::ffff:8.8.8.8",
  ].filter((address) => isPrivateAddress(address) || isBlockedAddress(address));
  assert.deepEqual(wrong, []);
});

test("URL host notations that Node's parser turns into a private address are caught after parsing", () => {
  const forms = [
    "http://2130706433/",
    "http://0x7f.0.0.1/",
    "http://017700000001/",
    "http://127.1/",
    "http://0/",
    "http://[::ffff:127.0.0.1]/",
    "http://[0:0:0:0:0:ffff:7f00:1]/",
    "http://127.0.0.1./",
    "http://①②⑦.0.0.1/",
    "http://127。0。0。1/",
    "http://localhost./",
    "http://[::]/",
    "http://[::1]/",
  ];
  const missed = forms.filter((url) => {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
    return host !== "localhost" && !isPrivateAddress(host);
  });
  assert.deepEqual(missed, []);
});

test("normalizeAddress is stable and total: no input makes it throw or change a plain IPv4", () => {
  for (const input of [
    "",
    " ",
    "[",
    "]",
    ":::",
    "1.2.3",
    "1.2.3.4.5",
    "::1::2",
    "g::1",
    "::ffff:",
    "::ffff:1.2.3",
    "%",
    "fe80::%",
    "\u0000",
    "x".repeat(10_000),
  ]) {
    assert.doesNotThrow(() => normalizeAddress(input), JSON.stringify(input.slice(0, 20)));
  }
  assert.equal(normalizeAddress("8.8.8.8"), "8.8.8.8");
});

// ---- Secrets in logs and in ciphertexts ------------------------------------------------------------

test("tokens in URLs are redacted wherever they sit, including query strings and encodings", () => {
  const secret = "SECRETTOKEN123";
  const urls = [
    `/share/${secret}`,
    `/api/share/${secret}/diagram.svg`,
    `/reset-password/${secret}`,
    `/invite/${secret}`,
    `/api/invitations/${secret}/accept`,
    `/api/invitations/${secret}`,
    `/share/${secret}?x=1`,
    `/api/share/${secret}#frag`,
    `/SHARE/${secret}`,
    `//share/${secret}`,
    `/api/share/%53ECRETTOKEN123/diagram.svg`,
  ];
  const leaked = urls.filter((url) => /SECRETTOKEN123|%53ECRETTOKEN123/i.test(redactShareTokens(url)));
  assert.deepEqual(leaked, []);
});

test("ciphertexts: tampering, truncation, a short tag, a swapped part or another key are all refused", () => {
  const sealed = encryptPayload({ password: "hunter2" });
  assert.deepEqual(decryptPayload(sealed), { password: "hunter2" });
  const [version, iv, tag, body] = sealed.split(":");
  const flip = (hex: string) => (hex[0] === "0" ? "1" : "0") + hex.slice(1);
  const bad = [
    `${version}:${iv}:${tag}:${flip(body)}`,
    `${version}:${iv}:${flip(tag)}:${body}`,
    `${version}:${flip(iv)}:${tag}:${body}`,
    `${version}:${iv}:${tag.slice(0, 8)}:${body}`,
    `${version}:${iv}:${tag.slice(0, 8)}:${body}`,
    `${version}:${iv}::${body}`,
    `${version}:${iv}:${tag}:`,
    `${version}:${iv}:${tag}`,
    `v2:${iv}:${tag}:${body}`,
    `${iv}:${tag}`,
    "",
    "::::",
    `${version}:${iv}:${tag}:${body}:extra`,
    `${version}:${iv}:${tag}${tag}:${body}`,
  ];
  const accepted = bad.filter((payload) => {
    try {
      decryptPayload(payload);
      return true;
    } catch {
      return false;
    }
  });
  assert.deepEqual(accepted, []);
});

test("encrypting the same value twice never gives the same ciphertext (the IV is fresh)", () => {
  const seen = new Set(Array.from({ length: 200 }, () => encryptPayload("same")));
  assert.equal(seen.size, 200);
});
