import type { Config } from "./config.js";

/** A failure whose message is safe to hand to the agent: no key, no stack, no server internals. */
export class ToolError extends Error {}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type WriteMethod = "POST" | "PUT" | "PATCH" | "DELETE";
type Method = "GET" | WriteMethod;

/**
 * Client of the public API. The server is what decides what a write may do — an AI agent's key is
 * capped there whatever is sent from here.
 */
export class ApiClient {
  constructor(
    private readonly config: Config,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async json<T>(path: string): Promise<T> {
    const text = await this.text(path);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ToolError("the server answered something that is not JSON (is NEBULADB_URL the instance's address?)");
    }
  }

  /** POSTs a JSON body and parses the JSON answer. */
  async post<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>("POST", path, body);
  }

  /** Any write: a JSON body (none for a DELETE without one) and the JSON answer. */
  async send<T>(method: WriteMethod, path: string, body?: unknown): Promise<T> {
    const text = await this.request(method, path, body);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ToolError("the server answered something that is not JSON (is NEBULADB_URL the instance's address?)");
    }
  }

  async text(path: string): Promise<string> {
    return this.request("GET", path);
  }

  private async request(method: Method, path: string, body?: unknown): Promise<string> {
    const url = `${this.config.baseUrl}/api/v1${path}`;
    const headers: Record<string, string> = { authorization: `Bearer ${this.config.apiKey}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        // A redirect is a host the key was not meant for: refuse rather than follow.
        redirect: "error",
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (err) {
      throw new ToolError(describeNetworkFailure(this.config.baseUrl, err));
    }
    if (!response.ok) throw await describeHttpFailure(response);
    return response.text();
  }
}

async function describeHttpFailure(response: Response): Promise<ToolError> {
  let code = `HTTP_${response.status}`;
  let message = "";
  try {
    const parsed: unknown = JSON.parse(await response.text());
    if (parsed && typeof parsed === "object") {
      const { error, code: serverCode } = parsed as { error?: unknown; code?: unknown };
      if (typeof serverCode === "string") code = serverCode.slice(0, 80);
      if (typeof error === "string") message = error.slice(0, 300);
    }
  } catch {
    // Not JSON (a proxy's page): the status is all there is to say.
  }
  const status = response.status;
  let hint: string;
  if (status === 401) hint = "the API key is missing, wrong or revoked";
  else if (status === 403 && code === "AGENT_KEY_FORBIDDEN")
    hint = "an AI agent's key works inside projects only: no project creation or deletion, no administration";
  else if (status === 403 && code === "SQL_ACCESS_NOT_GRANTED")
    hint = "the key's owner has no SQL access to this database: an administrator grants it";
  else if (status === 403 && code.startsWith("API_"))
    hint = "the API key lacks the scope or is restricted to another project";
  else if (status === 403) hint = "the key's owner may not do that on this project";
  else if (status === 404) hint = "not found (check the project id)";
  else if (status === 409)
    hint = "refused as things stand (read the message: a confirmation or another step may be needed)";
  else if (status === 429) hint = "rate limited: retry later";
  else if (status >= 500) hint = "the server failed";
  else hint = "request refused";
  return new ToolError(`NebulaDB answered ${status} ${code}: ${hint}${message ? ` (${message})` : ""}`);
}

function describeNetworkFailure(baseUrl: string, err: unknown): string {
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
  const code = (cause as { code?: unknown } | null)?.code;
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError") return `${baseUrl} did not answer in time`;
  if (err instanceof Error && /redirect/i.test(err.message)) {
    return `${baseUrl} redirected the request: use the address the instance is served at (https://?)`;
  }
  return `cannot reach ${baseUrl}: ${typeof code === "string" ? code : "network error"}`;
}
