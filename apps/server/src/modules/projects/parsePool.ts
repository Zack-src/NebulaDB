import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { runParseTask, type ParseResult, type ParseTask } from "./parseTask.js";

/**
 * Runs `runParseTask` off the event loop. A @dbml/core parse is synchronous and
 * slow (~250 ms at 130 tables, ~950 ms at 500), and the DBML panel posts one on
 * every typing pause — in the main thread that froze every room and request of
 * the process for the whole parse.
 *
 * A small fixed pool (1-2 threads, one task each at a time, FIFO queue behind
 * them), not piscina: the protocol is one message each way, and this keeps the
 * timeout and fallback rules in one readable place:
 *
 *  - **timeout**: a task still running after `timeoutMs` has its thread
 *    terminated (the only way to stop a synchronous parse) and comes back as a
 *    parse failure — the input is what made it pathological;
 *  - **crash**: a thread that dies mid-task (OOM, ...) fails that task with an
 *    internal error, and is replaced on the next task;
 *  - **fallback**: if a thread can't even start (worker file missing from the
 *    build, a runtime without worker support), the pool gives up on threads for
 *    the rest of the process and parses inline, as before — slower, never
 *    broken.
 *
 * Threads are `unref`'d so an idle pool never keeps the process (or a test
 * file) alive; the timer of a running task is what does, as long as it runs.
 */

export interface ParsePoolOptions {
  size?: number;
  timeoutMs?: number;
  /** Sources shorter than this are parsed inline: a thread round trip (and its cold start) costs more than they do. */
  inlineBelowChars?: number;
  /** Test seam: what a pool thread is. Defaults to `parseWorker.js` next to this file. */
  spawn?: () => Worker;
}

interface Job {
  task: ParseTask;
  resolve: (result: ParseResult) => void;
}

interface Slot {
  worker: Worker;
  /** Set by the thread's `ready` message — an error before it means threads don't work here at all. */
  ready: boolean;
  job: Job | null;
  jobId: number;
  timer: NodeJS.Timeout | null;
}

type WorkerMessage = { ready: true } | { id: number; result: ParseResult };

export interface ParsePool {
  run(task: ParseTask): Promise<ParseResult>;
  /** Terminates every thread; whatever was running or queued still completes, inline. */
  close(): Promise<void>;
  stats(): { threads: number; busy: number; queued: number; inlineOnly: boolean };
}

function defaultSpawn(): Worker {
  // Under `tsx` (dev, scripts) this module is `parsePool.ts`, and the worker
  // must be its `.ts` sibling too — tsx's loader reaches the thread through the
  // inherited `execArgv`. In the build it's `dist/modules/projects/parseWorker.js`.
  const ext = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
  return new Worker(new URL(`./parseWorker${ext}`, import.meta.url));
}

export function createParsePool(options: ParsePoolOptions = {}): ParsePool {
  const size = Math.max(1, options.size ?? Math.min(2, availableParallelism() - 1));
  const timeoutMs = options.timeoutMs ?? 30_000;
  const inlineBelowChars = options.inlineBelowChars ?? 8_192;
  const spawn = options.spawn ?? defaultSpawn;

  const slots: Slot[] = [];
  const queue: Job[] = [];
  let inlineOnly = false;
  let nextId = 1;

  const runInline = (job: Job) => job.resolve(runParseTask(job.task));

  /** Detaches the slot's job (if any) and stops its timer; returns the job. */
  function release(slot: Slot): Job | null {
    const job = slot.job;
    if (slot.timer) clearTimeout(slot.timer);
    slot.job = null;
    slot.timer = null;
    return job;
  }

  /** Removes the slot from the pool *before* terminating it, so its `exit` reads as intended. */
  function retire(slot: Slot) {
    const index = slots.indexOf(slot);
    if (index !== -1) slots.splice(index, 1);
    void slot.worker.terminate();
  }

  function failSlot(slot: Slot, result: ParseResult) {
    retire(slot);
    release(slot)?.resolve(result);
    pump();
  }

  function giveUpOnThreads(err: unknown) {
    if (!inlineOnly) {
      console.warn(
        `[parsePool] worker threads unavailable, parsing DBML/SQL inline: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    inlineOnly = true;
    for (const slot of [...slots]) {
      retire(slot);
      const job = release(slot);
      if (job) runInline(job);
    }
    while (queue.length > 0) runInline(queue.shift()!);
  }

  function addSlot(): Slot | null {
    let worker: Worker;
    try {
      worker = spawn();
    } catch (err) {
      giveUpOnThreads(err);
      return null;
    }
    const slot: Slot = { worker, ready: false, job: null, jobId: 0, timer: null };
    worker.on("message", (message: WorkerMessage) => {
      if ("ready" in message) {
        slot.ready = true;
        return;
      }
      if (slot.job && message.id === slot.jobId) release(slot)!.resolve(message.result);
      pump();
    });
    worker.on("error", (err: Error) => {
      if (!slots.includes(slot)) return;
      if (!slot.ready) giveUpOnThreads(err);
      else failSlot(slot, { ok: false, kind: "internal", message: `parse worker failed: ${err.message}` });
    });
    worker.on("exit", (code) => {
      if (!slots.includes(slot)) return; // retired on purpose: timeout, error above, close
      if (!slot.ready) giveUpOnThreads(new Error(`parse worker exited during startup (code ${code})`));
      else failSlot(slot, { ok: false, kind: "internal", message: `parse worker exited unexpectedly (code ${code})` });
    });
    // After the listeners, not before: attaching a `message` listener re-refs
    // the thread's port, and an idle pool would then hold the process open.
    worker.unref();
    slots.push(slot);
    return slot;
  }

  function dispatch(slot: Slot, job: Job) {
    slot.job = job;
    slot.jobId = nextId++;
    slot.timer = setTimeout(() => {
      failSlot(slot, {
        ok: false,
        kind: "parse",
        error: { message: `parsing took longer than ${Math.round(timeoutMs / 1000)} s and was stopped` },
      });
    }, timeoutMs);
    slot.worker.postMessage({ id: slot.jobId, task: job.task });
  }

  function pump() {
    while (queue.length > 0 && !inlineOnly) {
      const slot = slots.find((s) => s.job === null) ?? (slots.length < size ? addSlot() : null);
      if (!slot) return;
      dispatch(slot, queue.shift()!);
    }
  }

  return {
    run(task) {
      return new Promise<ParseResult>((resolve) => {
        const job: Job = { task, resolve };
        if (inlineOnly || task.source.length < inlineBelowChars) {
          runInline(job);
          return;
        }
        queue.push(job);
        pump();
      });
    },
    async close() {
      const closing = slots.splice(0, slots.length);
      const running = closing.map(release).filter((job): job is Job => job !== null);
      queue.unshift(...running);
      await Promise.all(closing.map((slot) => slot.worker.terminate()));
      while (queue.length > 0) runInline(queue.shift()!);
    },
    stats() {
      return {
        threads: slots.length,
        busy: slots.filter((s) => s.job !== null).length,
        queued: queue.length,
        inlineOnly,
      };
    },
  };
}

let sharedPool: ParsePool | null = null;

/** The process-wide pool every import route shares, started on first use. */
export function parsePool(): ParsePool {
  sharedPool ??= createParsePool();
  return sharedPool;
}

export async function closeParsePool(): Promise<void> {
  const pool = sharedPool;
  sharedPool = null;
  await pool?.close();
}
