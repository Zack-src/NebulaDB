import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMention, type Comment, type Table } from "@athanordb/shared";
import { buildCommentNotice } from "./commentNotice";

const comment = (id: string, authorId: string | undefined, text: string, fieldId?: string): Comment => ({
  id,
  author: "x",
  authorId,
  text,
  createdAt: "2026-10-05T10:00:00Z",
  fieldId,
});

const table = (comments: Comment[]): Table => ({
  id: "t1",
  name: "customers",
  fields: [{ id: "f1", name: "email", type: "varchar" }],
  indexes: [],
  position: { x: 0, y: 0 },
  detailLevel: "standard",
  comments,
});

test("comment notice: an ordinary comment in an empty thread asks nothing of the server", () => {
  const mine = comment("c1", "me", "just a note");
  assert.equal(buildCommentNotice(table([mine]), mine, "me"), null);
});

test("comment notice: a mention of someone else is sent with the table and column; a mention of oneself is not", () => {
  const mentioning = comment("c1", "me", `look ${formatMention("Bob", "bob")}`, "f1");
  assert.deepEqual(buildCommentNotice(table([mentioning]), mentioning, "me"), {
    text: mentioning.text,
    tableName: "customers",
    columnName: "email",
    threadUserIds: [],
  });
  const self = comment("c2", "me", `note to ${formatMention("Me", "me")}`);
  assert.equal(buildCommentNotice(table([self]), self, "me"), null);
});

test("comment notice: a reply names the others who wrote in that very thread", () => {
  const earlier = [
    comment("c1", "ann", "question", "f1"),
    comment("c2", "me", "mine", "f1"),
    comment("c3", "cat", "other column", undefined),
    comment("c4", undefined, "from before accounts were stamped", "f1"),
    comment("c5", "ann", "again", "f1"),
  ];
  const reply = comment("c6", "me", "answer", "f1");
  assert.deepEqual(buildCommentNotice(table([...earlier, reply]), reply, "me")?.threadUserIds, ["ann"]);
});
