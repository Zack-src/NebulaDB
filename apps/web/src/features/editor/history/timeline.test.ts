import { test } from "node:test";
import assert from "node:assert/strict";
import type { HistoryMarker } from "@nebuladb/shared";
import type { RevisionSummary } from "@/services/projectsApi";
import { buildTimeline, type RevisionEntry } from "./timeline";

let counter = 0;
function revision(
  author: string,
  time: string,
  tables: [string, "added" | "removed" | "changed"][] = [["t", "changed"]],
  label: string | null = null,
): RevisionSummary {
  counter += 1;
  return {
    id: `r${counter}`,
    author,
    label,
    createdAt: `2026-10-03 ${time}`,
    changes: { tables: tables.map(([name, status]) => ({ name, status })), moreTables: 0, refs: 0 },
  };
}

const revisionsOf = (entries: ReturnType<typeof buildTimeline>) =>
  entries.map((entry) => (entry.kind === "revisions" ? entry.revisions.map((r) => r.id).join("+") : entry.marker.kind));

test("close edits by one person are one line, newest line first", () => {
  const a = revision("alice", "10:00:00");
  const b = revision("alice", "10:01:00");
  const c = revision("alice", "10:02:30");
  const d = revision("bob", "10:02:40");

  assert.deepEqual(revisionsOf(buildTimeline([a, b, c, d], [])), [d.id, `${a.id}+${b.id}+${c.id}`]);
});

test("a pause, another author, a label or a marker ends the run", () => {
  const a = revision("alice", "10:00:00");
  const b = revision("alice", "10:05:00"); // more than two minutes later
  const c = revision("alice", "10:05:30", undefined, "v1.0");
  const d = revision("alice", "10:06:00");
  const lock: HistoryMarker = { kind: "lock", at: "2026-10-03 10:06:10", actor: "bob", detail: "orders" };
  const e = revision("alice", "10:06:20");

  assert.deepEqual(revisionsOf(buildTimeline([a, b, c, d, e], [lock])).reverse(), [
    a.id,
    b.id,
    c.id,
    d.id,
    "lock",
    e.id,
  ]);
});

test("a run never spans more than its window, however steady the edits", () => {
  const edits = Array.from({ length: 20 }, (_, i) => revision("alice", `11:${String(i).padStart(2, "0")}:00`));
  const lines = buildTimeline(edits, [], { maxSpanMs: 10 * 60_000 });
  assert.equal(lines.length, 2);
});

test("within one second, a restore sits right before the revision it wrote; other markers after the edits", () => {
  const a = revision("alice", "13:00:05");
  const restored = revision("alice", "13:00:05");
  const restore: HistoryMarker = {
    kind: "restore",
    at: "2026-10-03 13:00:05",
    actor: "alice",
    detail: "",
    producedRevisionId: restored.id,
  };
  const lock: HistoryMarker = { kind: "lock", at: "2026-10-03 13:00:05", actor: "bob", detail: "orders" };

  assert.deepEqual(revisionsOf(buildTimeline([a, restored], [lock, restore])).reverse(), [
    a.id,
    "restore",
    restored.id,
    "lock",
  ]);
});

test("a run reports each table's net change", () => {
  const entries = buildTimeline(
    [
      revision("alice", "12:00:00", [["orders", "added"]]),
      revision("alice", "12:00:20", [
        ["orders", "changed"],
        ["tmp", "added"],
      ]),
      revision("alice", "12:00:40", [
        ["tmp", "removed"],
        ["users", "removed"],
      ]),
    ],
    [],
  );
  assert.equal(entries.length, 1);
  assert.deepEqual((entries[0] as RevisionEntry).tables, [
    { name: "orders", status: "added" },
    { name: "users", status: "removed" },
  ]);
});
