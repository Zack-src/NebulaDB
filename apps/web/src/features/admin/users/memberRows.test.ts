import { test } from "node:test";
import assert from "node:assert/strict";
import { memberRows } from "./memberRows";
import type { InvitationSummary, UserSummary } from "@/types";

const user: UserSummary = {
  id: "user",
  email: "member@example.com",
  displayName: "Member",
  isAdmin: false,
  createdAt: "2026-10-06T10:00:00Z",
};
const invitation: InvitationSummary = {
  token: "accepted",
  email: " MEMBER@example.com ",
  isAdmin: false,
  createdAt: "2026-10-05T10:00:00Z",
  expiresAt: "2026-10-12T10:00:00Z",
  status: "accepted",
};

test("accepted invitations join their account case-insensitively", () => {
  const rows = memberRows([user], [invitation]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user, user);
  assert.equal(rows[0].invitation?.status, "accepted");
});

test("accounts without an invitation stay visible and non-accepted invitations do not replace their status", () => {
  assert.equal(memberRows([user], [])[0].user, user);
  assert.equal(memberRows([user], [{ ...invitation, status: "expired" }])[0].invitation, null);
});

test("reissued invitations show only the latest status regardless of API ordering", () => {
  const latest = { ...invitation, token: "latest", status: "pending" as const, createdAt: "2026-10-06T10:00:00Z" };
  const old = { ...invitation, status: "expired" as const };
  for (const invitations of [
    [latest, old],
    [old, latest],
  ]) {
    const rows = memberRows([], invitations);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].invitation?.token, "latest");
  }
});

test("accepted invitations whose account was deleted remain distinguishable from pending invitations", () => {
  assert.equal(memberRows([], [invitation])[0].invitation?.status, "accepted");
});
