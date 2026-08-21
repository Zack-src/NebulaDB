/**
 * The subset of a Pino/Fastify logger's shape the realtime layer needs —
 * `warn`/`error` only, called `(fields, message)` like every other
 * structured log line in this server. A small interface of its own (rather
 * than importing `FastifyBaseLogger`) so `room.ts`/`room/limits.ts` have no
 * other Fastify dependency, and so both can import this without importing
 * each other — `console` satisfies this shape too, which is the fallback
 * `roomRegistry.ts` uses before `setRoomLogger` runs, and what tests get by
 * default.
 *
 * What this buys, and what it doesn't: every `Room` gets the same
 * structured/JSON logger as the rest of the server instead of bare
 * `console` text, and every line here carries a `room` field to filter or
 * correlate by project. It does *not* carry a per-request id — a `Room`
 * outlives any single request (many connections and REST calls touch the
 * same one over its lifetime), so there is no single request to tag these
 * with. Where a log line *does* correspond to exactly one connection (the
 * WS route's join/leave lines), `app.ts` uses that connection's own
 * `req.log` instead, which does carry one.
 */
export interface RoomLogger {
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}
