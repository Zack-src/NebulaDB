import { test } from "node:test";
import assert from "node:assert/strict";
import type { DbGrant, DbPrincipal } from "@nebuladb/shared";
import {
  applyAccountDelta,
  canonicalAccountLines,
  diffAccountLines,
  hashAccountLines,
  principalKey,
  summarizeAccountChanges,
  type AccountListing,
} from "./accountFingerprint.js";

function principal(name: string, extra: Partial<DbPrincipal> = {}): DbPrincipal {
  return { name, kind: "user", canLogin: true, locked: false, superuser: false, system: false, memberOf: [], ...extra };
}

function grant(privileges: string[], extra: Partial<DbGrant> = {}): DbGrant {
  return { scope: "table", schema: "public", table: "orders", privileges, grantable: false, ...extra };
}

const listing = (): AccountListing[] => [
  {
    key: "app",
    principal: principal("app", { memberOf: ["readers", "writers"] }),
    grants: [grant(["SELECT", "INSERT"])],
  },
  { key: "readers", principal: principal("readers", { kind: "role", canLogin: false }), grants: [] },
  { key: "postgres", principal: principal("postgres", { superuser: true, system: true }), grants: null },
];

test("account fingerprint: the same state gives the same hash, whatever order the engine listed it in", () => {
  const a = canonicalAccountLines(listing());
  const shuffled = listing().reverse();
  shuffled[2] = {
    ...shuffled[2],
    principal: principal("app", { memberOf: ["writers", "readers"] }),
    grants: [grant(["insert", " SELECT "])],
  };
  const b = canonicalAccountLines(shuffled);
  assert.deepEqual(a, b);
  assert.equal(hashAccountLines(a), hashAccountLines(b));
  // Never anything but names, flags and privileges.
  assert.ok(a.every((line) => Array.isArray(JSON.parse(line))));
});

test("account fingerprint: a privilege granted or revoked changes the hash and says which", () => {
  const before = canonicalAccountLines(listing());
  const changed = listing();
  changed[0] = { ...changed[0], grants: [grant(["SELECT", "INSERT", "DELETE"])] };
  const after = canonicalAccountLines(changed);
  assert.notEqual(hashAccountLines(before), hashAccountLines(after));
  const { added, removed } = diffAccountLines(before, after);
  assert.deepEqual(removed, []);
  assert.deepEqual(summarizeAccountChanges(added, removed), [
    { type: "privilege-granted", principal: "app", scope: "table", object: "public.orders", privilege: "DELETE" },
  ]);
  // The other way round is a revocation; a grant option and a SQL Server DENY are told apart.
  assert.equal(summarizeAccountChanges(removed, added)[0].type, "privilege-revoked");
  const withOption = listing();
  withOption[0] = {
    ...withOption[0],
    grants: [grant(["SELECT"], { grantable: true }), grant(["INSERT"], { denied: true })],
  };
  const options = diffAccountLines(before, canonicalAccountLines(withOption));
  const privileges = summarizeAccountChanges(options.added, options.removed)
    .filter((c) => c.type === "privilege-granted")
    .map((c) => c.privilege);
  assert.deepEqual(privileges.sort(), ["DENY INSERT", "SELECT (WITH GRANT)"]);
});

test("account fingerprint: an account created, dropped, locked or given a role is one change each", () => {
  const before = canonicalAccountLines(listing());
  const next = listing().filter((entry) => entry.key !== "readers");
  next[0] = {
    ...next[0],
    principal: principal("app", { memberOf: ["writers", "admins"], locked: true, canLogin: false }),
  };
  next.push({
    key: "intruder@%",
    principal: principal("intruder", { host: "%", superuser: true }),
    grants: [grant(["ALL"])],
  });
  const { added, removed } = diffAccountLines(before, canonicalAccountLines(next));
  const changes = summarizeAccountChanges(added, removed);
  const said = changes.map((c) => `${c.type} ${c.principal}${c.role ? ` ${c.role}` : ""}`).sort();
  // The new account's own flags and grants are not repeated; nor are the dropped role's.
  assert.deepEqual(said, [
    "created intruder@%",
    "dropped readers",
    "locked app",
    "role-granted app admins",
    "role-revoked app readers",
  ]);
  assert.equal(principalKey(principal("sa"), "shop"), "shop/sa");
  assert.equal(principalKey(principal("app", { host: "10.%" })), "app@10.%");
});

test("account fingerprint: a change Nebula made moves the reference, one made elsewhere stays a difference", () => {
  const reference = canonicalAccountLines(listing());
  // Someone else revoked INSERT before Nebula acted.
  const outside = listing();
  outside[0] = { ...outside[0], grants: [grant(["SELECT"])] };
  const before = canonicalAccountLines(outside);
  // Nebula then created a role.
  const after = canonicalAccountLines([
    ...outside,
    { key: "auditors", principal: principal("auditors", { kind: "role", canLogin: false }), grants: [] },
  ]);
  const moved = applyAccountDelta(reference, before, after);
  const left = diffAccountLines(moved, after);
  assert.deepEqual(
    summarizeAccountChanges(left.added, left.removed).map((c) => `${c.type} ${c.privilege ?? ""}`),
    ["privilege-revoked INSERT"],
  );
  assert.ok(moved.includes(JSON.stringify(["account", "auditors"])));
  // Nothing done outside: the reference becomes exactly what was read.
  assert.equal(
    hashAccountLines(applyAccountDelta(reference, reference, canonicalAccountLines(outside))),
    hashAccountLines(canonicalAccountLines(outside)),
  );
});
