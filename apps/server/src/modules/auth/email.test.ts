import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidEmail, normalizeEmail, MAX_EMAIL_LENGTH } from "./email.js";

test("isValidEmail accepts ordinary addresses", () => {
  assert.equal(isValidEmail("user@example.com"), true);
  assert.equal(isValidEmail("first.last+tag@sub.example.co.uk"), true);
});

test("isValidEmail rejects the shapes the old '@'-only check let through", () => {
  assert.equal(isValidEmail("a@"), false);
  assert.equal(isValidEmail("a@b@c"), false, "the exact regression case from docs/todo.md");
  assert.equal(isValidEmail("@b"), false);
  assert.equal(isValidEmail("no-at-sign"), false);
  assert.equal(isValidEmail("has space@example.com"), false);
  assert.equal(isValidEmail("user@no-tld"), false);
  assert.equal(isValidEmail("user@.com"), false);
});

test("isValidEmail enforces the RFC 5321 length cap", () => {
  const domain = "@example.com";
  const exactlyAtCap = "a".repeat(MAX_EMAIL_LENGTH - domain.length) + domain;
  assert.equal(exactlyAtCap.length, MAX_EMAIL_LENGTH);
  assert.equal(isValidEmail(exactlyAtCap), true);

  const oneOver = "a".repeat(MAX_EMAIL_LENGTH - domain.length + 1) + domain;
  assert.equal(isValidEmail(oneOver), false);
});

test("normalizeEmail trims and lowercases a valid address", () => {
  assert.equal(normalizeEmail("  User@Example.COM  "), "user@example.com");
});

test("normalizeEmail returns null for non-strings and invalid addresses", () => {
  assert.equal(normalizeEmail(undefined), null);
  assert.equal(normalizeEmail(12345), null);
  assert.equal(normalizeEmail("a@b@c"), null);
  assert.equal(normalizeEmail(""), null);
});
