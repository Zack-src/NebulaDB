import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync.js";
import * as awarenessProtocol from "y-protocols/awareness.js";
import * as encoding from "lib0/encoding.js";
import * as decoding from "lib0/decoding.js";
import type { WebSocket } from "ws";
import { ENUMS_KEY, META_KEY, REFS_KEY, STICKY_NOTES_KEY, TABLE_GROUPS_KEY, TABLES_KEY, ZONES_KEY } from "@athanordb/shared";
import { appendRevision, saveSnapshot, loadSnapshot } from "./persistence.js";
import { timeSync } from "../infrastructure/perf.js";
import { LIMIT_ORIGIN, enforceLimits } from "./room/limits.js";
import type { RoomLogger } from "./room/logger.js";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const SNAPSHOT_DEBOUNCE_MS = 2000;

const COLLECTION_KEYS = [META_KEY, TABLES_KEY, REFS_KEY, ENUMS_KEY, ZONES_KEY, STICKY_NOTES_KEY, TABLE_GROUPS_KEY];

/**
 * How long a connection's resolved access is trusted before being looked up
 * again. Bounds how long a revoked permission can stay effective when nothing
 * calls `revalidate()` explicitly — the routes that change grants do call it,
 * so this is the backstop for paths that don't (a direct SQL edit, the
 * `bootstrap-admin` script, a future route that forgets).
 *
 * Not zero: `receive()` runs per WebSocket frame, and dragging a table emits
 * dozens a second, each of which would otherwise cost a fresh permission
 * lookup (up to four SQLite reads). Five seconds keeps that at negligible
 * cost while being far below any human-meaningful window.
 */
const ACCESS_TTL_MS = 5000;

/**
 * Re-evaluates one connection's access on demand. Returns `null` when the user
 * has lost access to the project entirely (removed from the only team that
 * granted it, account disabled, project restricted since they connected), in
 * which case the room closes the connection.
 *
 * A callback rather than an imported permission check so this file stays
 * unaware of how permissions are modelled — the room only ever needed to know
 * "may this socket write", and now also "may it still be here at all".
 */
export type AccessResolver = () => { canWrite: boolean } | null;

export type { RoomLogger };

interface ConnMeta {
  author: string;
  awarenessClientIds: Set<number>;
  resolveAccess: AccessResolver;
  canWrite: boolean;
  accessCheckedAt: number;
}

/**
 * One project's live collaborative document: a Y.Doc shared over WS by all
 * connected clients, an Awareness instance for presence/cursors, and
 * SQLite-backed persistence (append-only revision log + debounced snapshot).
 */
export class Room {
  readonly doc = new Y.Doc();
  readonly awareness: awarenessProtocol.Awareness;
  private readonly conns = new Map<WebSocket, ConnMeta>();
  private snapshotTimer: NodeJS.Timeout | null = null;
  private destroyed = false;
  private disposed = false;
  /** Collection key -> entity ids written since the last `enforceLimits()` pass. */
  private readonly pendingChecks = new Map<string, Set<string>>();

  constructor(
    private readonly projectId: string,
    private readonly onEmpty: () => void,
    private readonly log: RoomLogger = console,
  ) {
    const snapshot = loadSnapshot(projectId);
    if (snapshot) Y.applyUpdate(this.doc, snapshot);

    this.awareness = new awarenessProtocol.Awareness(this.doc);

    // Note every entity touched by an incoming update so `enforceLimits()`
    // only has to re-check what actually changed, instead of walking the
    // whole project on every keystroke-sized update.
    for (const collection of COLLECTION_KEYS) {
      this.doc.getMap(collection).observe((event, transaction) => {
        if (transaction.origin === LIMIT_ORIGIN) return;
        let ids = this.pendingChecks.get(collection);
        if (!ids) {
          ids = new Set();
          this.pendingChecks.set(collection, ids);
        }
        event.changes.keys.forEach((change, key) => {
          if (change.action !== "delete") ids.add(key);
        });
      });
    }

    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      timeSync("room.docUpdate", () => this.handleDocUpdate(update, origin));
    });

    this.awareness.on(
      "update",
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        const meta = this.conns.get(origin as WebSocket);
        if (meta) {
          added.forEach((id) => meta.awarenessClientIds.add(id));
          removed.forEach((id) => meta.awarenessClientIds.delete(id));
        }

        const changed = added.concat(updated, removed);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
        this.broadcast(encoding.toUint8Array(encoder), origin as WebSocket | undefined);
      },
    );
  }

  /** Body of the `doc.on("update")` handler above — split out only so `timeSync` can wrap it. */
  private handleDocUpdate(update: Uint8Array, origin: unknown): void {
    // A project deleted out from under a still-open room (e.g. someone has
    // it open in another tab while it's deleted from the list) must not
    // resurrect rows for an id that no longer exists in `projects` —
    // `destroy()` flips this before closing every connection.
    if (this.destroyed) return;
    // Two kinds of origin reach here: a WebSocket (a live, connected edit —
    // resolve through `conns`) or a plain string (a REST-triggered write
    // like import/restore, which has no connection — the route already
    // resolved the acting username and passed it straight through as the
    // transaction's origin).
    const author = typeof origin === "string" ? origin : (this.conns.get(origin as WebSocket)?.author ?? "system");
    // A DB write failing here (constraint violation, disk full, whatever)
    // must not crash the process — this runs inside a Yjs event handler, so
    // an uncaught throw takes down every other project's connections along
    // with this one. Log and keep going: the in-memory doc (and the
    // broadcast below) stay correct even if this particular write didn't
    // land.
    try {
      appendRevision(this.projectId, author, update);
    } catch (err) {
      this.log.error({ err, room: this.projectId }, "failed to append revision");
    }
    this.scheduleSnapshot();

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.broadcast(encoding.toUint8Array(encoder), origin as WebSocket | undefined);
  }

  join(conn: WebSocket, author: string, resolveAccess: AccessResolver): void {
    const initial = resolveAccess();
    this.conns.set(conn, {
      author,
      awarenessClientIds: new Set(),
      resolveAccess,
      canWrite: initial?.canWrite ?? false,
      accessCheckedAt: Date.now(),
    });

    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(syncEncoder, this.doc);
    conn.send(encoding.toUint8Array(syncEncoder));

    const states = this.awareness.getStates();
    if (states.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, Array.from(states.keys())),
      );
      conn.send(encoding.toUint8Array(awarenessEncoder));
    }
  }

  receive(conn: WebSocket, data: Uint8Array): void {
    // One aggregate label across every project/room rather than one per
    // project id — this fires on every WS frame from every client, so a
    // per-project label would leave `stats` growing without bound over the
    // life of the process.
    timeSync("room.receive", () => this.receiveInternal(conn, data));
  }

  private receiveInternal(conn: WebSocket, data: Uint8Array): void {
    const decoder = decoding.createDecoder(data);
    const messageType = decoding.readVarUint(decoder);

    if (messageType === MESSAGE_SYNC) {
      // A view-only connection must not be able to mutate the doc via a
      // hand-crafted WS frame that bypasses this app's own client entirely —
      // that has to be enforced here, not just hidden in the UI. Unlike
      // `syncProtocol.readSyncMessage` (which dispatches generically and
      // would apply an update regardless of permission), decode the inner
      // sync sub-message type ourselves first so syncStep2/update can be
      // dropped for a read-only connection while syncStep1 (a state-vector
      // request — read-only by construction, just produces a reply) stays
      // allowed either way.
      const canWrite = this.currentCanWrite(conn);
      const innerType = decoding.readVarUint(decoder);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      if (innerType === syncProtocol.messageYjsSyncStep1) {
        syncProtocol.readSyncStep1(decoder, encoder, this.doc);
        if (encoding.length(encoder) > 1) conn.send(encoding.toUint8Array(encoder));
      } else if (canWrite) {
        if (innerType === syncProtocol.messageYjsSyncStep2) {
          syncProtocol.readSyncStep2(decoder, this.doc, conn);
        } else if (innerType === syncProtocol.messageYjsUpdate) {
          syncProtocol.readUpdate(decoder, this.doc, conn);
        }
        // Yjs observers run synchronously during transaction cleanup, so by
        // the time the read above returns, `pendingChecks` holds everything
        // this frame touched.
        this.applyPendingLimits();
      }
    } else if (messageType === MESSAGE_AWARENESS) {
      // Cursor/presence stays allowed regardless of write access — cosmetic, not a schema mutation.
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), conn);
    }
  }

  leave(conn: WebSocket): void {
    const meta = this.conns.get(conn);
    this.conns.delete(conn);
    if (meta && meta.awarenessClientIds.size > 0) {
      awarenessProtocol.removeAwarenessStates(this.awareness, Array.from(meta.awarenessClientIds), null);
    }
    if (this.conns.size === 0) {
      if (this.snapshotTimer) {
        clearTimeout(this.snapshotTimer);
        this.snapshotTimer = null;
      }
      if (!this.destroyed) {
        try {
          saveSnapshot(this.projectId, this.doc);
        } catch (err) {
          this.log.error({ err, room: this.projectId }, "failed to save snapshot on last client leaving");
        }
      }
      // Evict once nobody's connected — every project ever opened otherwise
      // keeps a live Y.Doc + Awareness resident in memory for the process's
      // entire lifetime. Safe: `getRoom` recreates it on demand from the
      // snapshot just saved above, same as a fresh server start would.
      this.onEmpty();
      this.dispose();
    }
  }

  presence(): string[] {
    return Array.from(this.conns.values()).map((meta) => meta.author);
  }

  /** Live WebSocket connection count for this room — for `/api/metrics`, see `roomRegistry.ts`. */
  connectionCount(): number {
    return this.conns.size;
  }

  /**
   * Re-checks every connection's access right now, ignoring the TTL. Called by
   * the routes that change who can do what (team grants, team membership,
   * account disable/delete) so a revocation takes effect on already-open
   * sockets immediately rather than at the next TTL expiry.
   */
  revalidate(): void {
    // Snapshot first: `refreshAccess` can close a connection, and a close
    // handler running mid-iteration would mutate the map being iterated.
    for (const [conn, meta] of Array.from(this.conns.entries())) {
      this.refreshAccess(conn, meta);
    }
  }

  /**
   * Write access for one connection, re-resolved if the cached answer has gone
   * stale. Previously this was decided once, at connect time, and stored: an
   * admin downgrading someone from `edit` to `view` (or removing them from the
   * team entirely) left that person writing until they happened to reconnect,
   * which for a long-lived collaborative socket could be days.
   */
  private currentCanWrite(conn: WebSocket): boolean {
    const meta = this.conns.get(conn);
    if (!meta) return false;
    if (Date.now() - meta.accessCheckedAt < ACCESS_TTL_MS) return meta.canWrite;
    return this.refreshAccess(conn, meta);
  }

  private refreshAccess(conn: WebSocket, meta: ConnMeta): boolean {
    let access: { canWrite: boolean } | null;
    try {
      access = meta.resolveAccess();
    } catch (err) {
      // Fail closed. A permission lookup that throws (database locked, row
      // vanished mid-query) must not be read as "allowed" — and must not
      // propagate, since this runs inside a WebSocket message handler.
      this.log.error({ err, room: this.projectId, author: meta.author }, "permission re-check failed");
      meta.canWrite = false;
      return false;
    }
    meta.accessCheckedAt = Date.now();
    meta.canWrite = access?.canWrite ?? false;
    if (!access) {
      this.log.warn({ room: this.projectId, author: meta.author }, "lost access — closing connection");
      conn.close();
      return false;
    }
    return meta.canWrite;
  }

  /**
   * Deleting a project must stop this room from writing anything else back
   * to SQLite (the rows it would write to no longer exist) and disconnect
   * anyone still viewing it. Each socket's own `close` handler still calls
   * `leave()` afterwards — the `destroyed` flag above makes that a no-op
   * instead of resurrecting a snapshot/revision row for the deleted project.
   */
  destroy(): void {
    this.destroyed = true;
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    this.conns.forEach((_meta, conn) => conn.close());
    this.dispose();
  }

  /**
   * Releases what the room holds outside its own object graph.
   *
   * `Awareness` starts a `setInterval` in its constructor to expire stale
   * presence entries, and nothing was ever clearing it: dropping the room from
   * the `rooms` map (the eviction in `leave()`) removed the only reference the
   * server kept, but the live timer kept its own — so the Awareness, the
   * Y.Doc, and the whole project's contents stayed resident for the life of
   * the process, for every project ever opened. That is precisely the leak the
   * eviction exists to prevent.
   *
   * Idempotent: `destroy()` closes the connections, whose own close handlers
   * then call `leave()`, which reaches the eviction path again.
   */
  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.awareness.destroy();
    this.doc.destroy();
  }

  /**
   * Writes this room's current state to SQLite right now, cancelling any
   * pending debounced snapshot. Used on shutdown, where waiting out the
   * debounce would mean losing the last couple of seconds of edits.
   */
  flush(): void {
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    if (this.destroyed) return;
    try {
      saveSnapshot(this.projectId, this.doc);
    } catch (err) {
      this.log.error({ err, room: this.projectId }, "failed to save snapshot on flush");
    }
  }

  /**
   * Re-applies the shared per-field length/array-length limits to everything
   * the last update touched — see `room/limits.ts` for what and why. Reads
   * and clears `pendingChecks` itself so this stays the only place that
   * touches it. Named differently from the imported `enforceLimits` on
   * purpose — a same-named private method shadowing an imported function is
   * exactly the kind of thing worth a second glance in a diff.
   */
  private applyPendingLimits(): void {
    if (this.pendingChecks.size === 0) return;
    const pending = new Map(this.pendingChecks);
    this.pendingChecks.clear();
    enforceLimits(this.doc, this.projectId, pending, this.log);
  }

  private broadcast(message: Uint8Array, exclude?: WebSocket): void {
    this.conns.forEach((_meta, conn) => {
      if (conn !== exclude && conn.readyState === conn.OPEN) conn.send(message);
    });
  }

  private scheduleSnapshot(): void {
    if (this.snapshotTimer) return;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      try {
        saveSnapshot(this.projectId, this.doc);
      } catch (err) {
        this.log.error({ err, room: this.projectId }, "failed to save debounced snapshot");
      }
    }, SNAPSHOT_DEBOUNCE_MS);
  }
}

// The room registry (the `Map` of live rooms, and the free functions that
// operate over all of them — `getRoom`, `closeAllRooms`, etc.) lives in
// `./roomRegistry.js`. This file is deliberately just the `Room` class.
