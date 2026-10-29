import type { RetentionJournal, RetentionSource } from "@/services/retentionApi";

export type RetentionBounds = Pick<RetentionJournal, "min" | "max" | "allowForever" | "confirmBelow">;

export type RetentionDraft = { kind: "forever" } | { kind: "value"; value: number | null };

export type RetentionCheck =
  { ok: true; value: number; needsConfirm: boolean } | { ok: false; reason: "empty" | "integer" | "min" | "max" };

/** Whether an edit is acceptable before it is sent, with the same rules the server applies. */
export function checkRetention(bounds: RetentionBounds, draft: RetentionDraft): RetentionCheck {
  if (draft.kind === "forever") {
    // Kept forever is never "too short" for the server's confirmation.
    return bounds.allowForever ? { ok: true, value: 0, needsConfirm: false } : { ok: false, reason: "min" };
  }
  const { value } = draft;
  if (value === null) return { ok: false, reason: "empty" };
  if (!Number.isInteger(value)) return { ok: false, reason: "integer" };
  if (value < bounds.min) return { ok: false, reason: "min" };
  if (value > bounds.max) return { ok: false, reason: "max" };
  return { ok: true, value, needsConfirm: bounds.confirmBelow !== null && value < bounds.confirmBelow };
}

/** The draft that shows the value in force. */
export function draftOf(journal: Pick<RetentionJournal, "value">): RetentionDraft {
  return journal.value === 0 ? { kind: "forever" } : { kind: "value", value: journal.value };
}

/** Whether the draft differs from what is in force (nothing to save otherwise). */
export function isDirty(journal: Pick<RetentionJournal, "value">, draft: RetentionDraft): boolean {
  const current = draftOf(journal);
  if (current.kind !== draft.kind) return true;
  return draft.kind === "value" && current.kind === "value" && current.value !== draft.value;
}

/** An administrator's setting can be undone; one from the environment or the default is already the fallback. */
export function canReset(journal: Pick<RetentionJournal, "source">): boolean {
  return journal.source === "db";
}

export type SourceLabelKey =
  "admin.retention.source.default" | "admin.retention.source.env" | "admin.retention.source.db";

export function sourceLabelKey(source: RetentionSource): SourceLabelKey {
  return `admin.retention.source.${source}`;
}
