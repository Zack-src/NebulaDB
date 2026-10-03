/**
 * Background jobs: a name, a period, a function. Each job runs at most once
 * at a time — a pass still going when the next tick comes is not doubled up —
 * never throws into the event loop, and never holds the process open (timers
 * are `unref`ed). What the last run did is kept for whoever asks.
 *
 * Deliberately in-process and single-instance, like the rest of the server
 * (one SQLite file, one process): no queue, no lock table.
 */

export interface JobStatus {
  name: string;
  everyMs: number;
  running: boolean;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
}

interface Job extends JobStatus {
  timer: NodeJS.Timeout;
}

const jobs = new Map<string, Job>();

export function scheduleJob(name: string, everyMs: number, run: () => Promise<void> | void): void {
  if (jobs.has(name) || everyMs <= 0) return;
  const job: Job = {
    name,
    everyMs,
    running: false,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastError: null,
    timer: setInterval(() => void tick(), everyMs),
  };
  job.timer.unref();
  jobs.set(name, job);

  async function tick() {
    if (job.running) return;
    job.running = true;
    job.lastStartedAt = new Date().toISOString();
    try {
      await run();
      job.lastError = null;
    } catch (err) {
      job.lastError = err instanceof Error ? err.message : String(err);
      console.error(`[scheduler] ${name} failed:`, err);
    } finally {
      job.running = false;
      job.lastFinishedAt = new Date().toISOString();
    }
  }
}

export function listJobs(): JobStatus[] {
  return [...jobs.values()].map(({ timer: _timer, ...status }) => status);
}

export function stopAllJobs(): void {
  for (const job of jobs.values()) clearInterval(job.timer);
  jobs.clear();
}
