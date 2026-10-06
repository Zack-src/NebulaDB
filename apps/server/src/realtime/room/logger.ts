/**
 * The subset of a Pino/Fastify logger the realtime layer needs (`warn`/`error`, called
 * `(fields, message)`). Its own interface so `room.ts` and `room/limits.ts` have no Fastify
 * dependency; `console` satisfies it too (fallback before `setRoomLogger`, and in tests).
 *
 * Lines carry a `room` field, not a request id: a `Room` outlives any single request.
 */
export interface RoomLogger {
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}
