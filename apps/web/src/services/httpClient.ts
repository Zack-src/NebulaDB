import { ApiError, NetworkError } from "./ApiError";

/**
 * The single place the app talks to its API.
 *
 * Before this, forty-nine `fetch` calls spread across twenty components each
 * repeated the same four steps — set the JSON header, parse the body, branch on
 * `res.ok`, invent an error string — and each got the details slightly
 * differently. Everything here is that sequence, done once.
 */

const JSON_HEADERS = { "Content-Type": "application/json" };

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Serialised as JSON; the header is set for you. */
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const serialised = params.toString();
  return serialised ? `${path}?${serialised}` : path;
}

function toRequestInit(options: RequestOptions): RequestInit {
  return {
    method: options.method ?? "GET",
    signal: options.signal,
    ...(options.body === undefined ? {} : { headers: JSON_HEADERS, body: JSON.stringify(options.body) }),
  };
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  try {
    return await fetch(buildUrl(path, options.query), toRequestInit(options));
  } catch (err) {
    // An aborted request is the caller's own doing (a component unmounting,
    // a superseded search) — it must stay distinguishable from a real failure.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new NetworkError("the server could not be reached", err);
  }
}

/** Turns any non-2xx response into an `ApiError`, preserving `code` and any extra fields. */
async function toApiError(res: Response): Promise<ApiError> {
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const { error, code, ...details } = payload;
  return new ApiError(
    res.status,
    typeof code === "string" ? code : null,
    typeof error === "string" ? error : `request failed (${res.status})`,
    details,
  );
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await send(path, options);
  if (!res.ok) throw await toApiError(res);
  // 204 and other empty bodies are legitimate — `undefined as T` keeps the
  // caller from having to special-case a void endpoint.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** For endpoints that return `text/plain` (the DBML and SQL exports). */
export async function requestText(path: string, options: RequestOptions = {}): Promise<string> {
  const res = await send(path, options);
  if (!res.ok) throw await toApiError(res);
  return res.text();
}
