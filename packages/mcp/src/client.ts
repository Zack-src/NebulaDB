import type { Config } from "./config.js";

/** A failure whose message is safe to hand to the agent: no key, no stack, no server internals. */
export class ToolError extends Error {}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Read-only client of the public API: only GET exists here, on purpose. */
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

  async text(path: string): Promise<string> {
    const url = `${this.config.baseUrl}/api/v1${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: { authorization: `Bearer ${this.config.apiKey}` },
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
  else if (status === 403 && code.startsWith("API_")) hint = "the API key lacks the scope or is restricted to another project";
  else if (status === 403) hint = "the key's owner may not do that on this project";
  else if (status === 404) hint = "not found (check the project id)";
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
