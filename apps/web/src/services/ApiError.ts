/**
 * A failed API call, carrying the server's stable error `code` alongside its
 * English `message`.
 *
 * The code is what the UI switches on to show a translated message
 * (`i18n/serverErrorMessages.ts`); the message is the last-resort fallback for
 * a code this build doesn't know yet.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string | null, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Network failure, or a response that wasn't JSON at all — no server code to speak of. */
export class NetworkError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "NetworkError";
  }
}
