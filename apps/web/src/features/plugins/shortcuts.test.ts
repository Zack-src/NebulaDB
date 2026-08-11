import { test } from "node:test";
import assert from "node:assert/strict";
import { matchShortcut, normalizeShortcut, shortcutFromEvent } from "@/features/plugins/shortcuts";

function fakeEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    key: "a",
    ...overrides,
  } as KeyboardEvent;
}

test("normalizeShortcut orders modifiers consistently regardless of input order — the key always stays last", () => {
  assert.equal(normalizeShortcut("shift+ctrl+s"), "ctrl+shift+s");
  assert.equal(normalizeShortcut("ctrl+shift+s"), "ctrl+shift+s");
  assert.equal(normalizeShortcut("Ctrl+S"), "ctrl+s");
});

test("normalizeShortcut accepts common aliases for the same modifier", () => {
  assert.equal(normalizeShortcut("control+s"), "ctrl+s");
  assert.equal(normalizeShortcut("cmd+s"), "meta+s");
  assert.equal(normalizeShortcut("option+s"), "alt+s");
});

test("normalizeShortcut rejects a bare key with no modifier — it would fight with typing", () => {
  assert.equal(normalizeShortcut("s"), null);
  assert.equal(normalizeShortcut(""), null);
});

test("shortcutFromEvent produces the same modifier order normalizeShortcut does", () => {
  const event = fakeEvent({ ctrlKey: true, shiftKey: true, key: "S" });
  assert.equal(shortcutFromEvent(event), "ctrl+shift+s");
  assert.equal(shortcutFromEvent(event), normalizeShortcut("shift+ctrl+S"));
});

test("matchShortcut finds the item whose shortcut matches the event, and only that one", () => {
  const items = [
    { id: "a", shortcut: "ctrl+s" },
    { id: "b", shortcut: "ctrl+shift+s" },
    { id: "c" }, // no shortcut at all
  ];
  assert.equal(matchShortcut(items, fakeEvent({ ctrlKey: true, key: "s" }))?.id, "a");
  assert.equal(matchShortcut(items, fakeEvent({ ctrlKey: true, shiftKey: true, key: "s" }))?.id, "b");
  assert.equal(matchShortcut(items, fakeEvent({ ctrlKey: true, key: "x" })), undefined);
});

test("matchShortcut returns the first match when two items claim the same combination", () => {
  const items = [
    { id: "first", shortcut: "ctrl+s" },
    { id: "second", shortcut: "ctrl+s" },
  ];
  assert.equal(matchShortcut(items, fakeEvent({ ctrlKey: true, key: "s" }))?.id, "first");
});
