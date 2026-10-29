import { test } from "node:test";
import assert from "node:assert/strict";
import { canReset, checkRetention, draftOf, isDirty, sourceLabelKey } from "./retentionModel";

const audit = { min: 7, max: 3650, allowForever: true, confirmBelow: 90 };
const errors = { min: 100, max: 100_000, allowForever: false, confirmBelow: null };

test("a value inside the bounds is accepted, and asks for confirmation only below confirmBelow", () => {
  assert.deepEqual(checkRetention(audit, { kind: "value", value: 365 }), { ok: true, value: 365, needsConfirm: false });
  assert.deepEqual(checkRetention(audit, { kind: "value", value: 30 }), { ok: true, value: 30, needsConfirm: true });
  assert.deepEqual(checkRetention(audit, { kind: "value", value: 90 }), { ok: true, value: 90, needsConfirm: false });
  assert.deepEqual(checkRetention(errors, { kind: "value", value: 100 }), {
    ok: true,
    value: 100,
    needsConfirm: false,
  });
});

test("values outside the bounds, empty or fractional are refused", () => {
  assert.deepEqual(checkRetention(audit, { kind: "value", value: 6 }), { ok: false, reason: "min" });
  assert.deepEqual(checkRetention(audit, { kind: "value", value: 3651 }), { ok: false, reason: "max" });
  assert.deepEqual(checkRetention(audit, { kind: "value", value: null }), { ok: false, reason: "empty" });
  assert.deepEqual(checkRetention(audit, { kind: "value", value: 7.5 }), { ok: false, reason: "integer" });
});

test("forever is sent as 0 where allowed, without confirmation, and refused elsewhere", () => {
  assert.deepEqual(checkRetention(audit, { kind: "forever" }), { ok: true, value: 0, needsConfirm: false });
  assert.equal(checkRetention(errors, { kind: "forever" }).ok, false);
});

test("the draft starts at the value in force and is dirty only when it differs", () => {
  assert.deepEqual(draftOf({ value: 365 }), { kind: "value", value: 365 });
  assert.deepEqual(draftOf({ value: 0 }), { kind: "forever" });
  assert.equal(isDirty({ value: 365 }, { kind: "value", value: 365 }), false);
  assert.equal(isDirty({ value: 365 }, { kind: "value", value: 30 }), true);
  assert.equal(isDirty({ value: 365 }, { kind: "forever" }), true);
  assert.equal(isDirty({ value: 0 }, { kind: "forever" }), false);
  assert.equal(isDirty({ value: 0 }, { kind: "value", value: 7 }), true);
});

test("only an administrator's own setting can be reset", () => {
  assert.equal(canReset({ source: "db" }), true);
  assert.equal(canReset({ source: "env" }), false);
  assert.equal(canReset({ source: "default" }), false);
  assert.equal(sourceLabelKey("env"), "admin.retention.source.env");
});
