/**
 * What `index.html` started before the application's JavaScript was even parsed.
 *
 * A deep link to `/project/:id` needs the session, the project's summary and the live document, and all
 * three are known from the URL alone. The inline script in `index.html` asks for them at once, in
 * parallel with the download of the bundle; the code that would have asked for them later picks the
 * answers up here instead. Each is handed out once, and only while it is fresh: an answer older than a
 * few seconds belongs to a page nobody is looking at any more.
 */

/** A WebSocket opened early, with the messages that arrived before anything listened. */
export interface EarlySocket {
  socket: WebSocket;
  /** Binary messages received since the socket opened, in order. */
  buffered: ArrayBuffer[];
  /** The sync request has been sent (or is sent on open): the adopter must not send it again. */
  step1Sent: boolean;
  /** Set by the adopter; the inline script stops buffering. */
  taken: boolean;
}

interface EarlyStart {
  id: string;
  /** `performance.now()` when the inline script ran. */
  at: number;
  responses: Record<string, Promise<Response> | undefined>;
  ws: EarlySocket | null;
}

declare global {
  interface Window {
    __nebulaEarly?: EarlyStart;
  }
}

const FRESH_MS = 15_000;

function fresh(): EarlyStart | null {
  const early = typeof window === "undefined" ? undefined : window.__nebulaEarly;
  return early && performance.now() - early.at <= FRESH_MS ? early : null;
}

/** The response to a GET the inline script already sent, or `null`. */
export function takeEarlyResponse(path: string): Promise<Response> | null {
  const early = fresh();
  const response = early?.responses[path];
  if (!early || !response) return null;
  delete early.responses[path];
  return response;
}

/** The project's WebSocket, still usable, or `null` (another project, already taken, closed, or too old). */
export function takeEarlySocket(projectId: string): EarlySocket | null {
  const early = fresh();
  const ws = early?.ws;
  if (!early || !ws || early.id !== projectId || ws.taken) return null;
  if (ws.socket.readyState !== WebSocket.CONNECTING && ws.socket.readyState !== WebSocket.OPEN) return null;
  ws.taken = true;
  early.ws = null;
  return ws;
}
