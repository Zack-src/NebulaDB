import test from "node:test";
import assert from "node:assert/strict";
import { redactShareTokens } from "./logRedaction.js";

test("share, reset and invitation tokens are taken out of a logged URL", () => {
  assert.equal(redactShareTokens("/share/abc123?x=1"), "/share/[redacted]?x=1");
  assert.equal(redactShareTokens("/api/share/abc123/schema"), "/api/share/[redacted]/schema");
  assert.equal(redactShareTokens("/reset-password/tok"), "/reset-password/[redacted]");
  assert.equal(redactShareTokens("/invite/tok"), "/invite/[redacted]");
  assert.equal(redactShareTokens("/api/invitations/tok/accept"), "/api/invitations/[redacted]/accept");
  assert.equal(redactShareTokens("/api/projects/p1"), "/api/projects/p1");
});
