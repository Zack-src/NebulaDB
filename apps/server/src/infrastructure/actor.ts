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
/**
 * The request comes from an AI agent (an API key of kind `agent`) acting for `userId`. While it is
 * set, that account's permissions are capped (`shared/permissions.ts`): at most `deploy` on a
 * project, never instance administrator. `isAdmin` is what the account really is, so an instance
 * administrator's agent still sees the projects its owner sees.
 */
export interface AgentActor {
  userId: string;
  isAdmin: boolean;
}

const storage = new AsyncLocalStorage<{ userId: string | null; agent?: AgentActor | null }>();

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
  // Unattended work is nobody's, but the agent's caps still apply to anything it reaches.
  return storage.run({ userId: null, agent: storage.getStore()?.agent ?? null }, work);
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

/** Marks the current scope as an AI agent's (see `AgentActor`). Outside a scope this does nothing. */
export function setAgentActor(agent: AgentActor | null): void {
  const scope = storage.getStore();
  if (scope) scope.agent = agent;
}

/** The AI agent the current work is done by, if it is one. */
export function currentAgent(): AgentActor | null {
  return storage.getStore()?.agent ?? null;
}
