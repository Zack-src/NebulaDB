import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { useTestDatabase } from "../infrastructure/testDatabase.js";

await useTestDatabase("audit");
process.env.NEBULADB_COOKIE_SECURE = "false";

const { db } = await import("../infrastructure/db.js");
const { audit, auditUser, listAuditLog, purgeOldAuditEntries } = await import("./audit.js");

const fakeRequest = (ip: string) => ({ ip }) as FastifyRequest;

test("audit writes a row that comes back through listAuditLog", async () => {
  const projectId = randomUUID();
  await auditUser(
    { id: "user-1", email: "someone@example.com" },
    "project.delete",
    { type: "project", id: projectId },
    "Ventes",
    fakeRequest("10.0.0.4"),
  );

  const [entry] = await listAuditLog({ targetId: projectId });
  assert.ok(entry, "the entry is readable back");
  assert.equal(entry.action, "project.delete");
  assert.equal(entry.actorId, "user-1");
  assert.equal(entry.actorEmail, "someone@example.com");
  assert.equal(entry.targetType, "project");
  assert.equal(entry.detail, "Ventes");
  assert.equal(entry.ip, "10.0.0.4");
});

test("an anonymous actor is recorded rather than dropped", async () => {
  // The locked-login case: nobody is authenticated, but the attempt is exactly
  // what an operator would want to see.
  const email = `${randomUUID()}@example.com`;
  await audit({ id: null, email: null }, "auth.login.locked", { type: "user", id: email });
  const [entry] = await listAuditLog({ targetId: email });
  assert.equal(entry.action, "auth.login.locked");
  assert.equal(entry.actorId, null);
});

test("listAuditLog returns newest first and honours the limit", async () => {
  const target = randomUUID();
  for (const detail of ["first", "second", "third"]) {
    await auditUser({ id: "u", email: "u@example.com" }, "project.export", { type: "project", id: target }, detail);
  }
  const entries = await listAuditLog({ targetId: target });
  assert.equal(entries.length, 3);
  // Same-second inserts share a `created_at`, so ordering falls back to seq —
  // without that tiebreaker this assertion would be flaky rather than wrong.
  assert.equal(entries[0].detail, "third", "newest first");
  assert.equal((await listAuditLog({ targetId: target, limit: 2 })).length, 2);
});

test("listAuditLog filters by action", async () => {
  const target = randomUUID();
  await auditUser({ id: "u", email: "u@example.com" }, "project.create", { type: "project", id: target });
  await auditUser({ id: "u", email: "u@example.com" }, "project.export", { type: "project", id: target });
  const entries = await listAuditLog({ targetId: target, action: "project.create" });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].action, "project.create");
});

test("an over-long detail is truncated rather than stored whole", async () => {
  const target = randomUUID();
  await auditUser(
    { id: "u", email: "u@example.com" },
    "project.import",
    { type: "project", id: target },
    "x".repeat(5000),
  );
  const [entry] = await listAuditLog({ targetId: target });
  assert.ok(entry.detail!.length <= 500);
});

test("a failing audit write never throws into the caller", async () => {
  // The action being audited has already happened by the time `audit` runs —
  // turning an audit failure into a 500 would report a successful operation as
  // failed. Simulated by making the insert impossible.
  await db.exec("ALTER TABLE audit_log RENAME TO audit_log_moved");
  try {
    await assert.doesNotReject(auditUser({ id: "u", email: "u@example.com" }, "project.delete", null));
  } finally {
    await db.exec("ALTER TABLE audit_log_moved RENAME TO audit_log");
  }
});

test("the limit is clamped to a sane range", async () => {
  // Straight from a query string, so it has to survive nonsense without
  // either erroring or returning the whole table.
  await assert.doesNotReject(listAuditLog({ limit: -5 }));
  assert.ok((await listAuditLog({ limit: 100_000 })).length <= 500);
});

test("purgeOldAuditEntries deletes past the retention window and keeps the rest", async () => {
  const target = randomUUID();
  await auditUser({ id: "u", email: "u@example.com" }, "project.delete", { type: "project", id: target }, "old");
  await auditUser({ id: "u", email: "u@example.com" }, "project.delete", { type: "project", id: target }, "recent");
  // Backdate one of them rather than waiting a year.
  await db.prepare("UPDATE audit_log SET created_at = utc_now('-400 days') WHERE detail = 'old'").run();

  const removed = await purgeOldAuditEntries(365);
  assert.ok(removed >= 1);
  const left = await listAuditLog({ targetId: target });
  assert.equal(left.length, 1);
  assert.equal(left[0].detail, "recent");
});

test("a retention of 0 keeps everything", async () => {
  // An operator whose own rules require an indefinite trail must not have it
  // silently trimmed under them.
  const target = randomUUID();
  await auditUser({ id: "u", email: "u@example.com" }, "project.delete", { type: "project", id: target }, "ancient");
  await db.prepare("UPDATE audit_log SET created_at = utc_now('-4000 days') WHERE detail = 'ancient'").run();

  assert.equal(await purgeOldAuditEntries(0), 0);
  assert.equal((await listAuditLog({ targetId: target })).length, 1);
});
