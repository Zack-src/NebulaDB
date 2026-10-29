/** Test helper: a scripted global `fetch` that records every call. Not shipped — only tests import it. */

export interface RecordedCall {
  url: string;
  init: RequestInit;
  /** The parsed JSON body, when the request had one. */
  json: unknown;
}

type Reply = Response | Error | ((call: RecordedCall) => Response | Promise<Response>);

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Replaces `globalThis.fetch`; `restore()` puts the original back. Replies are consumed in order, the last one repeats. */
export function mockFetch(...replies: Reply[]) {
  const original = globalThis.fetch;
  const calls: RecordedCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call: RecordedCall = {
      url: String(input),
      init,
      json: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)] ?? jsonResponse({});
    if (reply instanceof Error) throw reply;
    return typeof reply === "function" ? reply(call) : reply;
  }) as typeof fetch;
  return {
    calls,
    last: () => calls[calls.length - 1],
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
