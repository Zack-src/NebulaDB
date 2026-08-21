import type * as Y from "yjs";
import {
  COLLECTION_COUNT_LIMITS,
  META_KEY,
  clampCollectionValue,
  clampMetaValue,
} from "@athanordb/shared";
import type { RoomLogger } from "./logger.js";

/**
 * Transaction origin for the server's own clamping writes. A plain string
 * (never a WebSocket) so the correction broadcasts to *every* client
 * including the one that sent the over-long value — otherwise that client
 * would keep its own longer version and the docs would diverge.
 *
 * Exported so `Room`'s collection observers can recognise (and ignore) their
 * own corrections instead of re-queuing them for another limits pass.
 */
export const LIMIT_ORIGIN = "system";

/**
 * Re-applies the shared per-field length/array-length limits to everything
 * `pending` says changed, truncating anything over its cap, then — for
 * collections with a top-level count limit — deletes back down to it.
 * Mutates `pending`'s entries away as it goes (the caller's map is cleared by
 * the caller itself; this only reads it) and writes via `doc.transact` under
 * `LIMIT_ORIGIN`, so the same collection observer that fed `pending` won't
 * re-queue the correction.
 *
 * The client's `maxLength` attributes (and the fact the UI has no "add
 * table #2001" button) are UX only: a WS frame is raw Yjs ops, so a
 * non-browser client (or a patched one) can put a megabyte in a table name,
 * or just keep inserting tables forever, and `Room.receive()` would happily
 * apply either — the permission check is the only thing that ever looked at
 * these frames. Clamping/deleting here rather than rejecting the frame keeps
 * the CRDT convergent: the offender's ops stay in the log, and the
 * correction is just another edit everyone (including the offender)
 * receives.
 *
 * The count cap only ever removes entities from *this transaction's own*
 * newly-touched set, never pre-existing ones — a burst that pushes a
 * project over the limit loses its own excess, a legitimate project that
 * happens to already be large is never touched by a later unrelated edit.
 */
export function enforceLimits(
  doc: Y.Doc,
  projectId: string,
  pending: Map<string, Set<string>>,
  log: RoomLogger = console,
): void {
  if (pending.size === 0) return;
  const entries = Array.from(pending.entries());

  doc.transact(() => {
    for (const [collection, ids] of entries) {
      const map = doc.getMap(collection);
      for (const id of ids) {
        const current = map.get(id);
        const clamped = collection === META_KEY ? clampMetaValue(id, current) : clampCollectionValue(collection, current);
        if (clamped !== null) {
          log.warn({ room: projectId, collection, entityId: id }, "clamped over-length input");
          map.set(id, clamped);
        }
      }

      const limit = COLLECTION_COUNT_LIMITS[collection];
      if (limit === undefined) continue;
      let over = map.size - limit;
      if (over <= 0) continue;
      let dropped = 0;
      for (const id of ids) {
        if (over <= 0) break;
        if (!map.has(id)) continue;
        map.delete(id);
        over--;
        dropped++;
      }
      if (dropped > 0) {
        log.warn(
          { room: projectId, collection, limit, dropped },
          "collection exceeded its entry cap — dropped entities added by this update",
        );
      }
    }
  }, LIMIT_ORIGIN);
}
