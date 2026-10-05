import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_MENTIONS_PER_COMMENT,
  extractMentionedUserIds,
  formatMention,
  parseCommentText,
  plainCommentText,
  storeMentions,
} from "./commentMentions.js";

test("mentions: a stored token is cut out of the text with its account id", () => {
  const text = `Ping ${formatMention("Alice Martin", "u-1")}, see this.`;
  assert.deepEqual(parseCommentText(text), [
    { type: "text", text: "Ping " },
    { type: "mention", userId: "u-1", name: "Alice Martin" },
    { type: "text", text: ", see this." },
  ]);
  assert.equal(plainCommentText(text), "Ping @Alice Martin, see this.");
});

test("mentions: plain text, and text that only looks like a token, mentions nobody", () => {
  assert.deepEqual(extractMentionedUserIds("hello @alice and @[x] and @[a b]( c )"), []);
  assert.deepEqual(parseCommentText(""), []);
  assert.deepEqual(parseCommentText("no mention"), [{ type: "text", text: "no mention" }]);
});

test("mentions: each account once, in order, capped", () => {
  const text = `${formatMention("A", "a")} ${formatMention("B", "b")} ${formatMention("A again", "a")}`;
  assert.deepEqual(extractMentionedUserIds(text), ["a", "b"]);
  const many = Array.from({ length: MAX_MENTIONS_PER_COMMENT + 5 }, (_, i) => formatMention("n", `u${i}`)).join(" ");
  assert.equal(extractMentionedUserIds(many).length, MAX_MENTIONS_PER_COMMENT);
});

test("mentions: a name cannot break out of its token", () => {
  const token = formatMention("Eve](evil) [x", "u-2");
  assert.deepEqual(extractMentionedUserIds(`hi ${token}`), ["u-2"]);
  assert.equal(parseCommentText(token).length, 1);
});

test("mentions: storing keeps only picked names, at the start of a word", () => {
  const picked = [
    { id: "u-1", name: "Alice" },
    { id: "u-2", name: "Alice Martin" },
  ];
  assert.equal(
    storeMentions("@Alice Martin and @Alice, mail me@Alice or @Alicette", picked),
    `${formatMention("Alice Martin", "u-2")} and ${formatMention("Alice", "u-1")}, mail me@Alice or @Alicette`,
  );
  assert.equal(storeMentions("@Bob", picked), "@Bob");
  assert.equal(storeMentions("(@Alice)", picked), `(${formatMention("Alice", "u-1")})`);
  assert.equal(storeMentions("@Al.ice", [{ id: "x", name: "Al.ice" }]), formatMention("Al.ice", "x"));
});
