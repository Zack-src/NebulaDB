import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync.js";
import * as awarenessProtocol from "y-protocols/awareness.js";
import * as encoding from "lib0/encoding.js";
import * as decoding from "lib0/decoding.js";
import { hashColor } from "@/features/collaboration/awarenessColor";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export interface CursorPosition {
  x: number;
  y: number;
}

export interface AwarenessState {
  user: { name: string; color: string };
  cursor: CursorPosition | null;
}

/**
 * `connecting` — first attempt, nothing synced yet. `connected` — live.
 * `reconnecting` — the socket dropped and a retry is scheduled; local edits
 * still apply to the local doc and flush on the next successful sync.
 * `closed` — `disconnect()` was called, no further retries.
 */
export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "closed";

export interface ProjectConnection {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  disconnect(): void;
}

/**
 * Origin tagged on every doc/awareness change that came off the wire, so the
 * outbound listeners can tell "remote update, already known to the server"
 * from "local edit, needs sending". It has to be a stable value rather than
 * the socket itself — the socket is replaced on every reconnect, and
 * `Y.UndoManager` (default `trackedOrigins: {null}`) relies on this being
 * non-null to keep remote edits out of the local undo stack.
 */
const REMOTE_ORIGIN = Symbol("athanordb-remote");

/**
 * Client-side half of the raw sync/awareness protocol implemented by the
 * server's `Room` (apps/server/src/yjs/room.ts) — mirrors its message
 * framing since we hand-roll the WS transport instead of using `y-websocket`.
 *
 * The socket is re-established with exponential backoff on any drop: a server
 * restart, a sleeping laptop or a flaky network otherwise left the editor
 * silently desynced until the user happened to reload. Yjs makes recovery
 * cheap — reconnecting just replays sync step 1/2, and any edits made while
 * offline merge in on the way back.
 *
 * `user` here is purely cosmetic (the awareness cursor's display name/color)
 * — the server independently resolves the authoritative identity from the
 * session cookie (sent automatically on same-origin WS upgrades), so it's no
 * longer passed on the URL at all.
 */
export function connectProject(
  projectId: string,
  user: string,
  onStatus?: (status: ConnectionStatus) => void,
): ProjectConnection {
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${location.host}/ws/${projectId}`;

  let socket: WebSocket | null = null;
  let attempts = 0;
  let retryTimer: number | null = null;
  let closedByUs = false;
  let status: ConnectionStatus = "connecting";

  const setStatus = (next: ConnectionStatus) => {
    if (status === next) return;
    status = next;
    onStatus?.(next);
  };

  const send = (bytes: Uint8Array<ArrayBuffer>) => {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(bytes);
  };

  const localAwarenessState = (): AwarenessState => ({
    user: { name: user, color: hashColor(user) },
    cursor: null,
  });

  const scheduleReconnect = () => {
    if (closedByUs || retryTimer !== null) return;
    // Exponential backoff, jittered so a server restart doesn't bring every
    // client back in the same instant.
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempts, RECONNECT_MAX_MS);
    attempts += 1;
    retryTimer = window.setTimeout(
      () => {
        retryTimer = null;
        open();
      },
      delay * (0.75 + Math.random() * 0.5),
    );
  };

  const open = () => {
    if (closedByUs) return;
    const ws = new WebSocket(url);
    socket = ws;
    ws.binaryType = "arraybuffer";

    ws.addEventListener("open", () => {
      if (ws !== socket) return;
      attempts = 0;
      setStatus("connected");

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, doc);
      ws.send(encoding.toUint8Array(encoder));

      // Set local state only once the socket is open: the awareness "update"
      // listener below drops updates while `readyState !== OPEN`, so setting
      // it any earlier would silently never reach the server. On a reconnect
      // this also re-publishes our cursor, which the server dropped when the
      // old connection closed.
      awareness.setLocalState(localAwarenessState());
    });

    ws.addEventListener("message", (event) => {
      const decoder = decoding.createDecoder(new Uint8Array(event.data as ArrayBuffer));
      const messageType = decoding.readVarUint(decoder);

      if (messageType === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, doc, REMOTE_ORIGIN);
        if (encoding.length(encoder) > 1) ws.send(encoding.toUint8Array(encoder));
      } else if (messageType === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), REMOTE_ORIGIN);
      }
    });

    const onGone = () => {
      if (ws !== socket) return;
      // Peers' cursors are stale the moment we lose the socket, and nothing
      // will tell us when they leave — drop every remote state so the presence
      // list doesn't keep showing ghosts until the reconnect lands.
      const remoteIds = Array.from(awareness.getStates().keys()).filter((id) => id !== doc.clientID);
      if (remoteIds.length > 0) awarenessProtocol.removeAwarenessStates(awareness, remoteIds, REMOTE_ORIGIN);
      socket = null;
      if (closedByUs) return;
      setStatus("reconnecting");
      scheduleReconnect();
    };

    ws.addEventListener("close", onGone);
    // A failed upgrade fires `error` then `close`; a mid-session transport
    // error may only fire `error`. `onGone` is idempotent for one socket
    // because it nulls `socket` and every path re-checks `ws !== socket`.
    ws.addEventListener("error", onGone);
  };

  // A tab that comes back online (or back to the foreground) shouldn't sit
  // out the rest of a 30s backoff.
  const retryNow = () => {
    if (closedByUs || socket !== null) return;
    if (document.visibilityState === "hidden") return;
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    attempts = 0;
    open();
  };
  window.addEventListener("online", retryNow);
  document.addEventListener("visibilitychange", retryNow);

  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    send(encoding.toUint8Array(encoder));
  });

  awareness.on(
    "update",
    ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === REMOTE_ORIGIN) return;
      const changed = added.concat(updated, removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
      send(encoding.toUint8Array(encoder));
    },
  );

  open();

  return {
    doc,
    awareness,
    disconnect() {
      closedByUs = true;
      setStatus("closed");
      window.removeEventListener("online", retryNow);
      document.removeEventListener("visibilitychange", retryNow);
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      try {
        awarenessProtocol.removeAwarenessStates(awareness, [doc.clientID], "disconnect");
      } catch {
        // ignore
      }
      const ws = socket;
      socket = null;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close();
    },
  };
}
