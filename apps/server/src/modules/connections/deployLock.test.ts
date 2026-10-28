import test from "node:test";
import assert from "node:assert/strict";
import { useTestDatabase } from "../../infrastructure/testDatabase.js";

await useTestDatabase("deploylock");

const { withDeploymentLock } = await import("./deploy.js");
const { ApiError } = await import("../../shared/errors.js");

const conn = { id: "conn-1", name: "Staging" };
const codeOf = (err: unknown) => (err instanceof ApiError ? err.code : String(err));

test("a second deployment on the same connection is refused at once while the first runs", async () => {
  let finish!: () => void;
  let started!: () => void;
  const holding = new Promise<void>((resolve) => (started = resolve));
  const running = withDeploymentLock(conn, () => {
    started();
    return new Promise<string>((resolve) => (finish = () => resolve("done")));
  });
  await holding;
  const second = await withDeploymentLock(conn, async () => "ran").catch(codeOf);
  assert.equal(second, "DEPLOYMENT_IN_PROGRESS");
  // Another connection is not held up.
  assert.equal(await withDeploymentLock({ id: "conn-2", name: "Other" }, async () => "ran"), "ran");
  finish();
  assert.equal(await running, "done");
  assert.equal(await withDeploymentLock(conn, async () => "ran"), "ran", "free once the first one ended");
});

test("the lock is let go when the deployment fails", async () => {
  const failed = await withDeploymentLock(conn, async () => {
    throw new ApiError("MIGRATION_FAILED");
  }).catch(codeOf);
  assert.equal(failed, "MIGRATION_FAILED");
  assert.equal(await withDeploymentLock(conn, async () => "ran"), "ran");
});
