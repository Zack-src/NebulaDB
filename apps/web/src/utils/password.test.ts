import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePassword } from "./password";

test("a generated password has the asked length and no look-alike characters", () => {
  for (const length of [8, 24, 64]) {
    const password = generatePassword(length);
    assert.equal(password.length, length);
    assert.doesNotMatch(password, /[01OlI]/);
  }
});

test("two generated passwords differ", () => {
  assert.notEqual(generatePassword(), generatePassword());
});
