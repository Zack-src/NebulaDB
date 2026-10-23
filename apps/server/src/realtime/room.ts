import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync.js";
import * as awarenessProtocol from "y-protocols/awareness.js";
import * as encoding from "lib0/encoding.js";
import * as decoding from "lib0/decoding.js";
import type { WebSocket } from "ws";
import {
  ENUMS_KEY,
  META_KEY,
  REFS_KEY,
  STICKY_NOTES_KEY,
  TABLE_GROUPS_KEY,
  TABLES_KEY,
  ZONES_KEY,
  findLockViolations,
  getRefsMap,
  getTablesMap,
  isRefInverted,
  reverseRef,
  revertLockViolations,
  type LockableSchema,
  type Ref,
  type ServerNotice,
  type Table,
} from "@nebuladb/shared";
import { appendRevision, saveSnapshotState, loadSnapshot } from "./persistence.js";
import { timeAsync, timeSync } from "../infrastructure/perf.js";
import { LIMIT_ORIGIN, enforceLimits } from "./room/limits.js";
import type { RoomLogger } from "./room/logger.js";

/** Transaction origin — and so the revision's author in the history panel — for `repairRefOrientation`. */
const REF_REPAIR_ORIGIN = "NebulaDB (sens des relations corrigé)";

/**
 * Told about every persisted doc change, with its author — how outgoing
 * webhooks learn about schema edits without this module importing the
 * webhooks module (which reads rooms, and would make a cycle). Set once from
 * `buildApp()`, same pattern as `setRoomLogger`.
 */
type DocChangeListener = (projectId: string, author: string) => void | Promise<void>;
let docChangeListener: DocChangeListener | null = null;

export function setRoomDocChangeListener(listener: DocChangeListener | null): void {
  docChangeListener = listener;
}

/**
 * Transaction origin — and so the revision's author in the history panel — for
 * the change that puts a locked table back after a connection altered it.
 */
const LOCK_REVERT_ORIGIN = "NebulaDB (table verrouillée rétablie)";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
/** Server → client only: a JSON `ServerNotice`. Clients that predate it ignore unknown message types. */
const MESSAGE_NOTICE = 2;
const SNAPSHOT_DEBOUNCE_MS = 2000;

const COLLECTION_KEYS = [META_KEY, TABLES_KEY, REFS_KEY, ENUMS_KEY, ZONES_KEY, STICKY_NOTES_KEY, TABLE_GROUPS_KEY];

/**
 * How long a connection's resolved access is trusted before being looked up again. The
 * backstop for paths that don't call `revalidate()` (a direct SQL edit, `bootstrap-admin`).
 * Not zero: `receive()` runs per WebSocket frame, and dragging emits dozens a second.
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
/**
 * `lockedTableIds`: the tables this connection may move and recolour but not
 * alter — every locked table of the project, minus those its user has the
 * authority to change. Absent or empty for the common case of no lock at all.
 */
interface ConnectionAccess {
  canWrite: boolean;
  lockedTableIds?: ReadonlySet<string>;
}

/** May answer at once (a test, a fixed answer) or after looking it up. */
export type AccessResolver = () => ConnectionAccess | null | Promise<ConnectionAccess | null>;

export type { RoomLogger };

interface ConnMeta {
  author: string;
  /** The account behind the connection — what `announceTo` matches on. `author` is a display name, and two accounts may share one. */
  userId: string | undefined;
  awarenessClientIds: Set<number>;
  resolveAccess: AccessResolver;
  canWrite: boolean;
  lockedTableIds: ReadonlySet<string>;
  accessCheckedAt: number;
}

const NO_LOCKS: ReadonlySet<string> = new Set();

/**
 * One project's live collaborative document: a Y.Doc shared over WS by all
 * connected clients, an Awareness instance for presence/cursors, and
 * database-backed persistence (append-only revision log + debounced snapshot).
 *
 * The doc is only ever changed synchronously, as Yjs requires; what reaches
 * the database does so afterwards, through two queues that keep the order the
 * synchronous storage used to give for free: `writes` (a revision is stored
 * before the next one, a snapshot never overtakes a newer one) and `inbox`
 * (a frame is fully handled before the next, even when handling it has to
 * look a permission up).
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
  /** Tail of the persistence queue. Never rejects: a failed write is logged where it is queued. */
  private writes: Promise<void> = Promise.resolve();
  /** Tail of the incoming-frame queue. Never rejects either. */
  private inbox: Promise<void> = Promise.resolve();
  private latestRevision: string | null = null;
  /** Settles once the doc-change listener has heard of every change so far. Never rejects. */
  private told: Promise<void> = Promise.resolve();

  /**
   * Loads the project's stored state and starts its room. The only way to get
   * one: reading the snapshot waits on the database, which a constructor
   * cannot do. `onEmpty` is given what the room still had to write when its
   * last client left — the project must not be reopened before that lands.
   */
  static async open(
    projectId: string,
    onEmpty: (settled: Promise<void>) => void,
    log: RoomLogger = console,
  ): Promise<Room> {
    return new Room(projectId, onEmpty, log, await loadSnapshot(projectId));
  }

  private constructor(
    private readonly projectId: string,
    private readonly onEmpty: (settled: Promise<void>) => void,
    private readonly log: RoomLogger,
    snapshot: Uint8Array | undefined,
  ) {
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

    // After the update handler above is wired, so the repair is persisted
    // (revision + snapshot) like any other change instead of being redone in
    // memory on every load.
    this.repairRefOrientation();
  }

  /**
   * One-off data repair for projects saved before ref direction was enforced
   * (see `refOrientation.ts`): an inline DBML ref used to be stored backwards,
   * which put the foreign key on the wrong table in SQL exports and
   * deployments. Flips only refs that are *certainly* inverted; idempotent,
   * so after the first load of a repaired project this finds nothing. Shows
   * up in the history under its own author name so nobody wonders who did it.
   */
  private repairRefOrientation(): void {
    const refsMap = getRefsMap(this.doc);
    if (refsMap.size === 0) return;
    const tablesById = new Map<string, Table>();
    getTablesMap(this.doc).forEach((table, id) => tablesById.set(id, table));
    const inverted: Ref[] = [];
    refsMap.forEach((ref) => {
      if (isRefInverted(ref, tablesById)) inverted.push(ref);
    });
    if (inverted.length === 0) return;
    this.doc.transact(() => {
      for (const ref of inverted) refsMap.set(ref.id, reverseRef(ref));
    }, REF_REPAIR_ORIGIN);
    this.log.warn({ room: this.projectId, repaired: inverted.length }, "re-oriented inverted refs");
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
    // A DB write failing here (constraint violation, database unreachable,
    // whatever) must not crash the process — this runs inside a Yjs event
    // handler, so an uncaught throw takes down every other project's
    // connections along with this one. `persist` logs and keeps going: the
    // in-memory doc (and the broadcast below) stay correct even if this
    // particular write didn't land.
    // The id is chosen here, not by the insert, so `lastRevisionId` can say
    // which revision a change became without waiting for it to be stored.
    const revisionId = crypto.randomUUID();
    this.latestRevision = revisionId;
    void this.persist("failed to append revision", () => appendRevision(this.projectId, author, update, revisionId));
    this.scheduleSnapshot();
    // Same resilience rule as the revision write above: a listener's failure
    // must never take the room down with it. Automatic repairs aren't news.
    if (docChangeListener && origin !== REF_REPAIR_ORIGIN && origin !== LOCK_REVERT_ORIGIN) {
      const listener = docChangeListener;
      // Through a promise whether or not the listener waits on anything, so a
      // throw and a rejection end up in the same place.
      const heard = Promise.resolve()
        .then(() => listener(this.projectId, author))
        .catch((err: unknown) => {
          this.log.error({ err, room: this.projectId }, "doc change listener failed");
        });
      this.told = Promise.all([this.told, heard]).then(() => {});
    }

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.broadcast(encoding.toUint8Array(encoder), origin as WebSocket | undefined);
  }

  /** `userId` absent: a connection no account-addressed notice (`announceTo`) will ever reach. */
  async join(conn: WebSocket, author: string, resolveAccess: AccessResolver, userId?: string): Promise<void> {
    const initial = await resolveAccess();
    // The socket closed while its access was being looked up: nothing joined, so nothing would ever leave.
    if (conn.readyState !== conn.OPEN) return;
    // The room emptied (or its project was deleted) meanwhile. Joining a room
    // nothing listens to would leave this client editing into the void; closed,
    // it reconnects and gets the project's current room.
    if (this.disposed) {
      conn.close();
      return;
    }
    this.conns.set(conn, {
      author,
      userId,
      awarenessClientIds: new Set(),
      resolveAccess,
      canWrite: initial?.canWrite ?? false,
      lockedTableIds: initial?.lockedTableIds ?? NO_LOCKS,
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

  /**
   * Handles one frame, after every frame received before it. Resolves once
   * this one is done; a frame that fails is logged and never rejects, so one
   * malformed message cannot wedge the queue behind it.
   */
  receive(conn: WebSocket, data: Uint8Array): Promise<void> {
    // One aggregate label across every project/room rather than one per
    // project id — this fires on every WS frame from every client, so a
    // per-project label would leave `stats` growing without bound over the
    // life of the process.
    this.inbox = this.inbox
      .then(() => timeAsync("room.receive", () => this.receiveInternal(conn, data)))
      .catch((err: unknown) => {
        this.log.error({ err, room: this.projectId }, "failed to handle a frame");
      });
    return this.inbox;
  }

  private async receiveInternal(conn: WebSocket, data: Uint8Array): Promise<void> {
    // The room was emptied or deleted while this frame waited its turn.
    if (this.disposed) return;
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
      // The only wait in this method, and only when the cached answer has
      // aged out: everything after it runs in one go, so the before/after
      // comparison a lock relies on cannot have another frame slip in between.
      const canWrite = await this.currentCanWrite(conn);
      if (this.disposed) return;
      const innerType = decoding.readVarUint(decoder);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      if (innerType === syncProtocol.messageYjsSyncStep1) {
        syncProtocol.readSyncStep1(decoder, encoder, this.doc);
        if (encoding.length(encoder) > 1) conn.send(encoding.toUint8Array(encoder));
      } else if (canWrite) {
        // Resolved by `currentCanWrite` just above, so never staler than the write permission itself.
        const locked = this.conns.get(conn)?.lockedTableIds ?? NO_LOCKS;
        const before = locked.size > 0 ? this.lockableSchema() : null;
        if (innerType === syncProtocol.messageYjsSyncStep2) {
          syncProtocol.readSyncStep2(decoder, this.doc, conn);
        } else if (innerType === syncProtocol.messageYjsUpdate) {
          syncProtocol.readUpdate(decoder, this.doc, conn);
        }
        if (before) this.revertLockedChanges(conn, before, locked);
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

  /** Resolves once whatever this departure had to store has landed. */
  leave(conn: WebSocket): Promise<void> {
    const meta = this.conns.get(conn);
    this.conns.delete(conn);
    // A socket that closed before `join` finished never entered the room;
    // emptying (and evicting) the room on its behalf would be wrong.
    if (!meta || this.disposed) return this.writes;
    if (meta.awarenessClientIds.size > 0) {
      awarenessProtocol.removeAwarenessStates(this.awareness, Array.from(meta.awarenessClientIds), null);
    }
    if (this.conns.size === 0) this.empty();
    return this.writes;
  }

  /** Nobody is connected: store the room's state and let go of it. */
  private empty(): void {
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    if (!this.destroyed) this.queueSnapshot("failed to save snapshot on last client leaving");
    // Evict once nobody's connected — every project ever opened otherwise
    // keeps a live Y.Doc + Awareness resident in memory for the process's
    // entire lifetime. Safe: `getRoom` recreates it on demand from the
    // snapshot queued above — which is why it is handed that write to wait
    // for, where a synchronous store had already finished it.
    this.onEmpty(this.writes);
    this.dispose();
  }

  /**
   * Evicts a room that was opened for a REST call and never had a client, which `leave` would
   * never reach. `false` (and nothing done) while anyone is connected.
   */
  evictIfIdle(): boolean {
    if (this.disposed || this.destroyed || this.conns.size > 0) return false;
    this.empty();
    return true;
  }

  /**
   * Changes the doc on behalf of someone who is not a connection — an import,
   * a restore, a pull — and resolves once the revision it made is stored and
   * the doc-change listener has heard of it, so the response that follows can
   * be trusted by a client that reads the history next. `author` is who the
   * history will name.
   *
   * Everything `change` is computed from must have been read from `doc` since
   * the caller last waited on anything: across an `await` a connected client
   * may have edited the doc, or the last one left and the room was evicted.
   */
  async write(change: () => void, author: string): Promise<void> {
    // Loud rather than lost: nothing listens to an evicted room's doc any more.
    if (this.disposed) throw new Error(`room ${this.projectId} was closed before the change could be applied`);
    this.doc.transact(change, author);
    await Promise.all([this.writes, this.told]);
  }

  /** The revision the latest change to the doc was recorded as; `null` if none since the room was loaded. */
  get lastRevisionId(): string | null {
    return this.latestRevision;
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
  async revalidate(): Promise<void> {
    // Snapshot first: `refreshAccess` can close a connection, and a close
    // handler running mid-iteration would mutate the map being iterated.
    await Promise.all(Array.from(this.conns.entries(), ([conn, meta]) => this.refreshAccess(conn, meta)));
  }

  /**
   * Write access for one connection, re-resolved if the cached answer has gone
   * stale. Previously this was decided once, at connect time, and stored: an
   * admin downgrading someone from `edit` to `view` (or removing them from the
   * team entirely) left that person writing until they happened to reconnect,
   * which for a long-lived collaborative socket could be days.
   */
  private async currentCanWrite(conn: WebSocket): Promise<boolean> {
    const meta = this.conns.get(conn);
    if (!meta) return false;
    if (Date.now() - meta.accessCheckedAt < ACCESS_TTL_MS) return meta.canWrite;
    return this.refreshAccess(conn, meta);
  }

  private async refreshAccess(conn: WebSocket, meta: ConnMeta): Promise<boolean> {
    let access: ConnectionAccess | null;
    try {
      access = await meta.resolveAccess();
    } catch (err) {
      // Fail closed. A permission lookup that throws (database unreachable,
      // row vanished mid-query) must not be read as "allowed" — and must not
      // propagate, since this runs inside a WebSocket message handler.
      this.log.error({ err, room: this.projectId, author: meta.author }, "permission re-check failed");
      // `canWrite` false already stops every write, locked table or not.
      meta.canWrite = false;
      return false;
    }
    meta.accessCheckedAt = Date.now();
    meta.canWrite = access?.canWrite ?? false;
    meta.lockedTableIds = access?.lockedTableIds ?? NO_LOCKS;
    if (!access) {
      this.log.warn({ room: this.projectId, author: meta.author }, "lost access — closing connection");
      conn.close();
      return false;
    }
    return meta.canWrite;
  }

  /** The current tables and relations, by reference — cheap enough to take before every guarded frame. */
  private lockableSchema(): LockableSchema {
    return { tables: Array.from(getTablesMap(this.doc).values()), refs: Array.from(getRefsMap(this.doc).values()) };
  }

  /**
   * Undoes what a connection's update did to tables locked against it. A realtime update
   * can't be refused before it is merged (a CRDT has no "un-apply"), so locked tables are
   * written back as they were, in a change every client receives. Backstop for hand-crafted
   * frames, outdated clients and plugins: the UI never sends such an update.
   *
   * Only structure is restored: a move, recolour or comment in the same update is kept.
   */
  private revertLockedChanges(conn: WebSocket, before: LockableSchema, locked: ReadonlySet<string>): void {
    const after = this.lockableSchema();
    const violations = findLockViolations(before, after, locked);
    if (violations.length === 0) return;

    const restored = revertLockViolations(before, after, violations);
    const violated = new Set(violations.map((violation) => violation.tableId));
    const tablesMap = getTablesMap(this.doc);
    const refsMap = getRefsMap(this.doc);
    this.doc.transact(() => {
      for (const table of restored.tables) if (violated.has(table.id)) tablesMap.set(table.id, table);
      for (const ref of after.refs) if (violated.has(ref.from.tableId)) refsMap.delete(ref.id);
      for (const ref of restored.refs) if (violated.has(ref.from.tableId)) refsMap.set(ref.id, ref);
    }, LOCK_REVERT_ORIGIN);

    const tables = violations.map((violation) => violation.tableName);
    this.log.warn(
      { room: this.projectId, author: this.conns.get(conn)?.author, tables },
      "reverted a change to locked tables",
    );
    this.sendNotice(conn, { type: "table-locked", tables });
  }

  /** Pushes a notice to every connection — "refetch this", never the data itself. */
  announce(notice: ServerNotice): void {
    this.conns.forEach((_meta, conn) => this.sendNotice(conn, notice));
  }

  /**
   * Pushes a notice to the connections of the given accounts and to nobody
   * else — for what concerns an account rather than the project, where telling
   * the whole room would tell it who was concerned.
   */
  announceTo(userIds: ReadonlySet<string>, notice: ServerNotice): void {
    this.conns.forEach((meta, conn) => {
      if (meta.userId !== undefined && userIds.has(meta.userId)) this.sendNotice(conn, notice);
    });
  }

  private sendNotice(conn: WebSocket, notice: ServerNotice): void {
    if (conn.readyState !== conn.OPEN) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_NOTICE);
    encoding.writeVarString(encoder, JSON.stringify(notice));
    conn.send(encoding.toUint8Array(encoder));
  }

  /**
   * Deleting a project must stop this room from writing anything else back
   * to the database (the rows it would write to no longer exist) and
   * disconnect anyone still viewing it. Each socket's own `close` handler
   * still calls `leave()` afterwards — the `destroyed` flag above makes that a
   * no-op instead of resurrecting a snapshot/revision row for the deleted
   * project.
   *
   * Resolves once the writes already under way have finished: deleting the
   * project's rows before then would race an insert that refers to them.
   */
  destroy(): Promise<void> {
    this.destroyed = true;
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    this.conns.forEach((_meta, conn) => conn.close());
    this.dispose();
    return this.writes;
  }

  /**
   * Releases what the room holds outside its own object graph: `Awareness` starts a
   * `setInterval` that otherwise keeps the room, its Y.Doc and the whole project resident for
   * the life of the process. Idempotent: closing connections calls `leave()` again.
   */
  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.awareness.destroy();
    this.doc.destroy();
  }

  /**
   * Writes this room's current state to the database right now, cancelling
   * any pending debounced snapshot, and resolves once it — and every revision
   * queued before it — is stored. Used on shutdown, where waiting out the
   * debounce would mean losing the last couple of seconds of edits.
   */
  flush(): Promise<void> {
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    if (!this.destroyed && !this.disposed) this.queueSnapshot("failed to save snapshot on flush");
    return this.writes;
  }

  /**
   * Queues a write behind the ones already waiting. One at a time, in the
   * order they were asked for: revisions replay in the order they were
   * stored, and a snapshot must not be overwritten by an older one that
   * happened to arrive later.
   */
  private persist(failure: string, write: () => Promise<void>): Promise<void> {
    this.writes = this.writes.then(write).catch((err: unknown) => {
      this.log.error({ err, room: this.projectId }, failure);
    });
    return this.writes;
  }

  /** Encoded now, while the doc is alive and exactly as it stands; stored when its turn comes. */
  private queueSnapshot(failure: string): void {
    const state = timeSync("persistence.encodeSnapshot", () => Y.encodeStateAsUpdate(this.doc));
    void this.persist(failure, () => saveSnapshotState(this.projectId, state));
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
      this.queueSnapshot("failed to save debounced snapshot");
    }, SNAPSHOT_DEBOUNCE_MS);
  }
}

// The room registry (the `Map` of live rooms, and the free functions that
// operate over all of them — `getRoom`, `closeAllRooms`, etc.) lives in
// `./roomRegistry.js`. This file is deliberately just the `Room` class.
