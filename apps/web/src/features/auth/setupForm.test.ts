import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSetupDraft, signedOutScreen, type SetupDraft } from "./setupForm";

const good: SetupDraft = {
  email: "  admin@example.com ",
  displayName: " Ada ",
  password: "correct horse battery staple",
  confirmation: "correct horse battery staple",
  token: "",
};

test("a complete draft becomes the request body, trimmed, without a token unless one is required", () => {
  assert.deepEqual(checkSetupDraft(good, false), {
    ok: true,
    payload: { email: "admin@example.com", displayName: "Ada", password: "correct horse battery staple" },
  });
  assert.deepEqual(checkSetupDraft({ ...good, token: " tok " }, true), {
    ok: true,
    payload: { email: "admin@example.com", displayName: "Ada", password: "correct horse battery staple", token: "tok" },
  });
});

test("the password is kept as typed: spaces are part of it", () => {
  const check = checkSetupDraft({ ...good, password: " spaced pass ", confirmation: " spaced pass " }, false);
  assert.equal(check.ok && check.payload.password, " spaced pass ");
});

test("each missing or invalid field is named, in screen order", () => {
  const problem = (draft: Partial<SetupDraft>, tokenRequired = false) => {
    const check = checkSetupDraft({ ...good, ...draft }, tokenRequired);
    return check.ok ? null : `${check.field}:${check.problem}`;
  };
  assert.equal(problem({}, true), "token:required");
  assert.equal(problem({ email: " " }), "email:required");
  assert.equal(problem({ email: "not-an-email" }), "email:emailInvalid");
  assert.equal(problem({ displayName: "  " }), "displayName:required");
  assert.equal(problem({ password: "" }), "password:required");
  assert.equal(problem({ password: "short", confirmation: "short" }), "password:tooShort");
  assert.equal(problem({ password: "x".repeat(129), confirmation: "x".repeat(129) }), "password:tooLong");
  assert.equal(problem({ confirmation: "something else" }), "confirmation:mismatch");
});

test("the setup screen shows only when the server says so", () => {
  assert.equal(signedOutScreen({ needsSetup: true, tokenRequired: false }), "setup");
  assert.equal(signedOutScreen({ needsSetup: false, tokenRequired: true }), "login");
  assert.equal(signedOutScreen(null), "login");
});
