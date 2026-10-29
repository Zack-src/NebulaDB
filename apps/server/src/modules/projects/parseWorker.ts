import { parentPort } from "node:worker_threads";
import { runParseTask, type ParseTask } from "./parseTask.js";

/**
 * Worker-thread entry for `parsePool.ts`: one task in, one result out, tagged
 * with the id the pool sent so it can match them up. Stateless — the pool may
 * terminate this thread at any time (timeout) and start a fresh one.
 *
 * The `ready` message tells the pool this module (and @dbml/core) actually
 * loaded: an error before it means threads can't work in this build at all,
 * not that one task went wrong.
 */

parentPort?.on("message", (message: { id: number; task: ParseTask }) => {
  parentPort!.postMessage({ id: message.id, result: runParseTask(message.task) });
});
parentPort?.postMessage({ ready: true });
