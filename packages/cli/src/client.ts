import type { Config } from "./config.js";

/** The server answered with an error status. `details` is what its `{ error, code, ... }` payload listed beyond the message and code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    const { error, code, ...details } = payload;
    super(typeof error === "string" ? error : `the server answered ${status}`);
    this.status = status;
    this.code = typeof code === "string" ? code : `HTTP_${status}`;
    this.details = details;
  }

  /** The key is missing, wrong, revoked or does not carry the scope: nothing the command asked was judged. */
  get isAuth(): boolean {
    return this.status === 401 || (this.status === 403 && this.code.startsWith("API_"));
  }
}

/** The server could not be reached, or did not answer in time. */
export class NetworkError extends Error {}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

export class ApiClient {
  constructor(
    private readonly config: Config,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async json<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const response = await this.send(method, path, body);
    return (await response.json()) as T;
  }

  async text(path: string): Promise<string> {
    return (await this.send("GET", path)).text();
  }

  async bytes(path: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.send("GET", path)).arrayBuffer());
  }

  private async send(method: string, path: string, body?: unknown): Promise<Response> {
    const url = `${this.config.baseUrl}/api/v1${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          ...(body !== undefined && { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        // A redirect is a host the key was not meant for (http to https, a moved instance): say so, do not follow.
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new NetworkError(describeNetworkFailure(this.config.baseUrl, err));
    }
    if (response.ok) return response;

    const text = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object") payload = parsed as Record<string, unknown>;
    } catch {
      // Not JSON (a proxy's page): the status is all there is to say.
    }
    throw new ApiError(response.status, payload);
  }
}

function describeNetworkFailure(baseUrl: string, err: unknown): string {
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
  const code = (cause as { code?: unknown } | null)?.code;
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError") return `${baseUrl} did not answer in time`;
  if (err instanceof Error && /redirect/i.test(err.message)) {
    return `${baseUrl} redirected the request: use the address the instance is served at (https://?)`;
  }
  const reason = typeof code === "string" ? code : cause instanceof Error ? cause.message : "unknown error";
  return `cannot reach ${baseUrl}: ${reason}`;
}
