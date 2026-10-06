/**
 * Who wins between the DBML buffer and the project document, and when. Done naively the two
 * directions fight and the user's text is "rolled back" while typing. Three rules:
 *
 *  1. **A newer buffer is never replaced by an older document.** Each edit bumps a revision; the
 *     document is mirrored back only once the server acknowledged *that* revision.
 *  2. **The baseline only advances on success.** The server uses it to tell "deleted here" from
 *     "added by someone else" (`preserveConcurrentAdditions`); advancing it on a merely *sent*,
 *     transiently invalid buffer brought back relations the user had just retargeted. Imports
 *     are sent one at a time for the same reason.
 *  3. **The document is not trusted right after an import**: the HTTP answer and the realtime
 *     update travel separately, so mirroring then is a visible rollback.
 *
 * Pure and timer-free: the panel owns the debounce and re-offers the document (`retryInMs`).
 */

/** No document is mirrored into the buffer this soon after a keystroke. */
export const TYPING_QUIET_MS = 1500;
/** How long an unchanged document is assumed to be the pre-import one. */
export const ECHO_GRACE_MS = 2000;

type BufferSyncStatus = "synced" | "pending" | "error";

export interface BufferSyncOptions<SendOptions = undefined> {
  initialText: string;
  /** Layout-insensitive fingerprint of a DBML text (`dbmlSignature`). */
  signatureOf: (text: string) => string;
  send: (source: string, baseline: string | undefined, options?: SendOptions) => Promise<unknown>;
  /** Outcome of an import, reported only while it still describes the current buffer. */
  onSettled?: (error: unknown) => void;
  now?: () => number;
}

interface DocumentOffer {
  /** Replace the buffer with this text. */
  adopt?: string;
  /** Nothing decided yet — offer the document again after this long. */
  retryInMs?: number;
}

export interface BufferSync<SendOptions = undefined> {
  /** The user changed the buffer. */
  edit(text: string): void;
  /**
   * Post the buffer if the server has not seen it. While an import is in
   * flight the next one waits for its answer, unless `force` — for a page
   * that is about to go away and cannot wait.
   */
  flush(options?: SendOptions, force?: boolean): void;
  /** The project document, re-serialised. */
  offerDocument(dbml: string): DocumentOffer;
  readonly text: string;
  readonly dirty: boolean;
  readonly status: BufferSyncStatus;
}

export function createBufferSync<SendOptions = undefined>(
  options: BufferSyncOptions<SendOptions>,
): BufferSync<SendOptions> {
  const now = options.now ?? (() => Date.now());

  let buffer = options.initialText;
  /** The last text known to describe the document: adopted from it, or acknowledged by it. */
  let baseline = options.initialText;
  /** The last document found to declare the same schema as the buffer — not worth fingerprinting again. */
  let equivalentDocument: string | null = null;
  let lastDocument = options.initialText;

  let revision = 0;
  let syncedRevision = 0;
  let failedRevision = -1;
  let inFlight = 0;
  let queued = false;
  let lastEditAt = Number.NEGATIVE_INFINITY;
  let echo: { staleDocument: string; until: number } | null = null;

  function flush(sendOptions?: SendOptions, force = false): void {
    if (revision === syncedRevision) return;
    if (inFlight > 0 && !force) {
      queued = true;
      return;
    }
    const sentRevision = revision;
    const source = buffer;
    const documentAtSend = lastDocument;
    inFlight++;
    options
      .send(source, baseline || undefined, sendOptions)
      .then(
        () => {
          baseline = source;
          if (revision !== sentRevision) return;
          syncedRevision = sentRevision;
          echo = { staleDocument: documentAtSend, until: now() + ECHO_GRACE_MS };
          options.onSettled?.(null);
        },
        (error: unknown) => {
          if (revision !== sentRevision) return;
          failedRevision = sentRevision;
          options.onSettled?.(error);
        },
      )
      .finally(() => {
        inFlight--;
        if (queued && inFlight === 0) {
          queued = false;
          flush();
        }
      });
  }

  return {
    edit(text) {
      buffer = text;
      revision++;
      lastEditAt = now();
    },
    flush,
    offerDocument(dbml) {
      lastDocument = dbml;
      if (revision !== syncedRevision || inFlight > 0) return {};
      if (dbml === buffer) {
        baseline = dbml;
        echo = null;
        return {};
      }
      if (dbml === baseline || dbml === equivalentDocument) return {};
      const time = now();
      if (echo && dbml === echo.staleDocument && time < echo.until) return { retryInMs: echo.until - time };
      const quietFor = time - lastEditAt;
      if (quietFor < TYPING_QUIET_MS) return { retryInMs: TYPING_QUIET_MS - quietFor };
      if (options.signatureOf(dbml) === options.signatureOf(buffer)) {
        // same schema, different layout — keep what the user is looking at
        equivalentDocument = dbml;
        return {};
      }
      buffer = dbml;
      baseline = dbml;
      echo = null;
      return { adopt: dbml };
    },
    get text() {
      return buffer;
    },
    get dirty() {
      return revision !== syncedRevision;
    },
    get status() {
      if (revision === syncedRevision) return "synced";
      return failedRevision === revision ? "error" : "pending";
    },
  };
}

/**
 * The smallest single replacement turning `current` into `next`.
 *
 * A schema resync (one attribute toggled on one column) used to replace the
 * *whole* buffer even though only a few characters differ — CodeMirror then
 * re-tokenizes and re-highlights the entire document, and every cursor and
 * selection lands wherever its old offset happens to fall. Trimming to the
 * changed range keeps the edit proportional to what changed and lets the
 * editor map the selection through it.
 */
export function minimalChange(current: string, next: string): { from: number; to: number; insert: string } | null {
  if (current === next) return null;
  let start = 0;
  const maxStart = Math.min(current.length, next.length);
  while (start < maxStart && current.charCodeAt(start) === next.charCodeAt(start)) start++;
  let endCurrent = current.length;
  let endNext = next.length;
  while (endCurrent > start && endNext > start && current.charCodeAt(endCurrent - 1) === next.charCodeAt(endNext - 1)) {
    endCurrent--;
    endNext--;
  }
  return { from: start, to: endCurrent, insert: next.slice(start, endNext) };
}
