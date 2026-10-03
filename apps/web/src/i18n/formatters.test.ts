import { test } from "node:test";
import assert from "node:assert/strict";
import { toDate } from "./formatters";

test("toDate reads the server's zone-less times as UTC, and leaves zoned values alone", () => {
  assert.equal(toDate("2026-10-03 11:39:05").toISOString(), "2026-10-03T11:39:05.000Z");
  assert.equal(toDate("2026-10-03T11:39:05").toISOString(), "2026-10-03T11:39:05.000Z");
  assert.equal(toDate("2026-10-03T11:39:05+02:00").toISOString(), "2026-10-03T09:39:05.000Z");
  assert.equal(toDate("2026-10-03T11:39:05.250Z").toISOString(), "2026-10-03T11:39:05.250Z");
  const now = new Date();
  assert.equal(toDate(now), now);
});
