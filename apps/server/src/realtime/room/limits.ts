import type * as Y from "yjs";
import { COLLECTION_COUNT_LIMITS, META_KEY, clampCollectionValue, clampMetaValue } from "@nebuladb/shared";
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
 * Re-applies the shared length limits to everything `pending` says changed, truncating what is
 * over its cap, then deletes collections back down to their count limit. Writes via
 * `doc.transact` under `LIMIT_ORIGIN` so the observer that fed `pending` doesn't re-queue it.
 *
 * Client `maxLength` is UX only: a WS frame is raw Yjs ops, so non-browser clients could insert
 * unbounded data. Clamping rather than rejecting keeps the CRDT convergent.
 *
 * The count cap only removes entities from *this transaction's* newly-touched set, so an
 * already-large legitimate project is never trimmed by an unrelated edit.
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
        const clamped =
          collection === META_KEY ? clampMetaValue(id, current) : clampCollectionValue(collection, current);
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
