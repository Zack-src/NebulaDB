import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { jsonResponse, mockFetch } from "../../test/fetchMock";
import { useAuthSession } from "./authSession.svelte";
import type { Session } from "@/types";

/**
 * `authSession.svelte.ts` uses the `$state` / `$effect` runes, which only the Svelte compiler defines. Here they
 * are stubbed with their plain-JS meaning (a variable; an effect that runs when the test says so), which is all
 * the logic under test depends on.
 */
const g = globalThis as Record<string, unknown>;
let effects: (() => void)[] = [];
let mock: ReturnType<typeof mockFetch>;
let pushed: unknown[][] = [];

beforeEach(() => {
  effects = [];
  pushed = [];
  g.$state = Object.assign((v: unknown) => v, { raw: (v: unknown) => v });
  g.$effect = (fn: () => void) => effects.push(fn);
  g.window = { history: { pushState: (...args: unknown[]) => pushed.push(args) } };
});
afterEach(() => {
  mock?.restore();
  delete g.$state;
  delete g.$effect;
  delete g.window;
});

const session = { id: "u1", email: "a@b.c" } as unknown as Session;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("useAuthSession", () => {
  test("starts in the loading state", () => {
    mock = mockFetch(() => jsonResponse(session));
    const auth = useAuthSession(() => {});
    assert.equal(auth.session, "loading");
    assert.equal(mock.calls.length, 0, "nothing is requested before the effect runs");
  });

  test("the bootstrap effect resolves to the current session", async () => {
    mock = mockFetch(() => jsonResponse(session));
    const auth = useAuthSession(() => {});
    effects.forEach((run) => run());
    await flush();
    assert.deepEqual(auth.session, session);
    assert.equal(mock.last().url, "/api/auth/me");
  });

  test("a 401 at bootstrap means signed out (null), not an error", async () => {
    mock = mockFetch(() => jsonResponse({ error: "unauthenticated" }, 401));
    const auth = useAuthSession(() => {});
    effects.forEach((run) => run());
    await flush();
    assert.equal(auth.session, null);
  });

  test("a network failure at bootstrap also lands on the login screen", async () => {
    mock = mockFetch(new TypeError("down"));
    const auth = useAuthSession(() => {});
    effects.forEach((run) => run());
    await flush();
    assert.equal(auth.session, null);
  });

  test("setSession replaces the session", () => {
    mock = mockFetch();
    const auth = useAuthSession(() => {});
    auth.setSession(session);
    assert.deepEqual(auth.session, session);
    auth.setSession(null);
    assert.equal(auth.session, null);
  });

  test("logout clears the session, calls onLogout and navigates to the root", async () => {
    mock = mockFetch(() => new Response(null, { status: 204 }));
    let loggedOut = 0;
    const auth = useAuthSession(() => loggedOut++);
    auth.setSession(session);
    await auth.logout();
    assert.equal(mock.last().url, "/api/auth/logout");
    assert.equal(mock.last().init.method, "POST");
    assert.equal(auth.session, null);
    assert.equal(loggedOut, 1);
    assert.deepEqual(pushed, [[null, "", "/"]]);
  });

  test("logout still signs out locally when the server revoke fails", async () => {
    mock = mockFetch(() => jsonResponse({ error: "boom" }, 500));
    let loggedOut = 0;
    const auth = useAuthSession(() => loggedOut++);
    auth.setSession(session);
    await auth.logout();
    assert.equal(auth.session, null);
    assert.equal(loggedOut, 1);
    assert.equal(pushed.length, 1);
  });

  test("logout still signs out locally when the server cannot be reached", async () => {
    mock = mockFetch(new TypeError("down"));
    const auth = useAuthSession(() => {});
    auth.setSession(session);
    await assert.doesNotReject(auth.logout());
    assert.equal(auth.session, null);
  });

  test("updateDisplayName stores the session the server answers with", async () => {
    const renamed = { ...session, displayName: "Ada" } as unknown as Session;
    mock = mockFetch(() => jsonResponse(renamed));
    const auth = useAuthSession(() => {});
    auth.setSession(session);
    await auth.updateDisplayName("Ada");
    assert.deepEqual(auth.session, renamed);
    assert.equal(mock.last().url, "/api/users/me");
    assert.equal(mock.last().init.method, "PATCH");
    assert.deepEqual(mock.last().json, { displayName: "Ada" });
  });

  test("a rejected display-name change leaves the session as it was and propagates", async () => {
    mock = mockFetch(() => jsonResponse({ error: "too long", code: "INVALID" }, 400));
    const auth = useAuthSession(() => {});
    auth.setSession(session);
    await assert.rejects(auth.updateDisplayName("x".repeat(500)));
    assert.deepEqual(auth.session, session);
  });
});
