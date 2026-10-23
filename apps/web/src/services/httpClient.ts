import { takeEarlyResponse } from "@/utils/earlyStart";
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
  /** Lets the request outlive a `beforeunload` (page close/reload) instead of being aborted with the document. */
  keepalive?: boolean;
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

/** A `keepalive` request may carry 64 KiB at most; `fetch` rejects a larger one outright. */
export const KEEPALIVE_MAX_BYTES = 60_000;

export function toRequestInit(options: RequestOptions): RequestInit {
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  const keepalive = options.keepalive && (body === undefined || new Blob([body]).size <= KEEPALIVE_MAX_BYTES);
  return {
    method: options.method ?? "GET",
    signal: options.signal,
    keepalive: keepalive || undefined,
    ...(body === undefined ? {} : { headers: JSON_HEADERS, body }),
  };
}

/** A plain GET that `index.html` already sent for this page load, if it is this one. */
function earlyResponse(path: string, options: RequestOptions): Promise<Response> | null {
  const plain = (options.method ?? "GET") === "GET" && options.body === undefined && !options.signal && !options.query;
  return plain ? takeEarlyResponse(path) : null;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const early = earlyResponse(path, options);
  if (early) {
    try {
      return await early;
    } catch {
      // The early request failed: ask again the usual way, which reports its own failure.
    }
  }
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

/** For endpoints that answer a file (the migration export's zip). */
export async function requestBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  const res = await send(path, options);
  if (!res.ok) throw await toApiError(res);
  return res.blob();
}

/** For endpoints that return `text/plain' (the DBML and SQL exports). */
export async function requestText(path: string, options: RequestOptions = {}): Promise<string> {
  const res = await send(path, options);
  if (!res.ok) throw await toApiError(res);
  return res.text();
}
