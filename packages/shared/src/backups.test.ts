import { test } from "node:test";
import assert from "node:assert/strict";
import { nextOccurrence, previousOccurrence, type BackupScheduleTiming } from "./backups.js";

const timing = (patch: Partial<BackupScheduleTiming>): BackupScheduleTiming => ({
  frequency: "daily",
  hour: 2,
  weekday: 1,
  dayOfMonth: 1,
  ...patch,
});
// Local time throughout, like the schedule itself. 2026-10-07 is a Wednesday.
const at = (day: number, hour: number, month = 9) => new Date(2026, month, day, hour);

test("a daily schedule fires at its hour, today or yesterday", () => {
  assert.deepEqual(previousOccurrence(timing({}), at(7, 3)), at(7, 2));
  assert.deepEqual(previousOccurrence(timing({}), at(7, 2)), at(7, 2), "the instant itself counts");
  assert.deepEqual(previousOccurrence(timing({}), at(7, 1)), at(6, 2));
  assert.deepEqual(nextOccurrence(timing({}), at(7, 3)), at(8, 2));
  assert.deepEqual(nextOccurrence(timing({}), at(7, 1)), at(7, 2));
});

test("a weekly schedule fires on its weekday", () => {
  const monday = timing({ frequency: "weekly", weekday: 1 });
  assert.deepEqual(previousOccurrence(monday, at(7, 12)), at(5, 2));
  assert.deepEqual(previousOccurrence(monday, at(5, 1)), at(28, 2, 8), "before the hour on the day: last week");
  assert.deepEqual(nextOccurrence(monday, at(7, 12)), at(12, 2));
});

test("a monthly schedule fires on its day, across the year's end", () => {
  const fifth = timing({ frequency: "monthly", dayOfMonth: 5 });
  assert.deepEqual(previousOccurrence(fifth, at(7, 12)), at(5, 2));
  assert.deepEqual(previousOccurrence(fifth, at(3, 12)), at(5, 2, 8));
  assert.deepEqual(previousOccurrence(fifth, new Date(2027, 0, 2, 0)), new Date(2026, 11, 5, 2));
  assert.deepEqual(nextOccurrence(fifth, new Date(2026, 11, 20, 0)), new Date(2027, 0, 5, 2));
});
