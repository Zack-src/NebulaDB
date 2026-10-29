import assert from "node:assert/strict";
import { test } from "node:test";
import { shortcutLabel, tourStepsFor } from "./tourSteps";

const ids = (options: Parameters<typeof tourStepsFor>[0]) => tourStepsFor(options).map((step) => step.id);

test("an administrator who can query a database gets every step, in tab order", () => {
  assert.deepEqual(
    ids({
      tabs: ["schema", "deployments", "history", "problems", "dictionary", "variants"],
      deployments: true,
      sql: true,
    }),
    ["schema", "deployments", "history", "dictionary", "problems", "sql", "palette"],
  );
});

test("a step about a drawer the user does not have is left out", () => {
  assert.deepEqual(ids({ tabs: ["schema", "history", "problems", "dictionary"], deployments: false, sql: false }), [
    "schema",
    "history",
    "dictionary",
    "problems",
    "palette",
  ]);
});

test("the palette step never goes away", () => {
  assert.deepEqual(ids({ tabs: [], deployments: false, sql: false }), ["palette"]);
});

test("Ctrl reads as the command key on a Mac", () => {
  assert.equal(shortcutLabel("Ctrl+J", true), "⌘+J");
  assert.equal(shortcutLabel("Ctrl+J", false), "Ctrl+J");
});
