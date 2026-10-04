import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who a request acts for, carried across the request's own async work —
 * without threading a user through every function that ends up opening a
 * database driver.
 *
 * It exists for one question, asked where a driver is created
 * (`connections/personalCredentials.ts`): "is a person doing this, and who?".
 * A request has an actor once its session or API key is resolved; a scheduled
 * job (the watch, scheduled backups, health checks) runs outside any request
 * and has none.
 */
const storage = new AsyncLocalStorage<{ userId: string | null }>();

/** Opens a scope with no actor yet; everything `next` starts, now or later, belongs to it. */
export function runInActorScope<T>(next: () => T): T {
  return storage.run({ userId: null }, next);
}

/**
 * Runs `work` as nobody: what it opens uses a connection's service account
 * even when a person triggered it. For work whose answer is about the
 * database, not about that person — "is it up?".
 */
export function asUnattended<T>(work: () => T): T {
  return storage.run({ userId: null }, work);
}

/** Names the current scope's actor. Outside a scope (a job, a script) this does nothing. */
export function setActor(userId: string | null): void {
  const scope = storage.getStore();
  if (scope) scope.userId = userId;
}

/** The account the current work is done for; `null` for unattended work. */
export function currentActorId(): string | null {
  return storage.getStore()?.userId ?? null;
}
