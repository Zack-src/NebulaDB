import { buildWorkerSource } from "@/features/plugins/sandboxRuntime";
import type {
  Contribution,
  ContributionKind,
  HostToWorkerMessage,
  InvokeContext,
  InvokeInput,
  InvokeResult,
  PluginManifest,
  WorkerToHostMessage,
} from "@/features/plugins/types";

const LOAD_TIMEOUT_MS = 5000;
const INVOKE_TIMEOUT_MS = 10000;
const MAX_LOG_LINES = 50;

export interface PluginLoad {
  manifest: PluginManifest;
  contributions: Contribution[];
}

interface Pending {
  resolve: (value: InvokeResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * One sandboxed user plugin: owns its Worker, its handshake and its calls.
 *
 * Every call is bounded by a timeout because a plugin is third-party code and
 * an accidental `while (true)` in a Worker cannot be interrupted any other way
 * — the only cure is `terminate()`. A timed-out host restarts itself lazily on
 * the next call rather than staying dead, so one bad export doesn't require
 * reinstalling the plugin.
 */
export class PluginHost {
  private worker: Worker | null = null;
  private blobUrl: string | null = null;
  private loading: Promise<PluginLoad> | null = null;
  private nextCallId = 1;
  private readonly pending = new Map<number, Pending>();
  private disposed = false;
  readonly logs: string[] = [];

  constructor(
    private readonly code: string,
    private readonly onLog?: (line: string) => void,
  ) {}

  /** Boots the worker (if needed) and resolves once the plugin has registered its contributions. */
  load(): Promise<PluginLoad> {
    if (this.disposed) return Promise.reject(new Error("plugin host disposed"));
    if (this.loading) return this.loading;

    this.loading = new Promise<PluginLoad>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        finish(() => {
          this.kill();
          reject(new Error(`plugin did not finish loading within ${LOAD_TIMEOUT_MS}ms`));
        });
      }, LOAD_TIMEOUT_MS);

      let worker: Worker;
      try {
        const blob = new Blob([buildWorkerSource(this.code)], { type: "text/javascript" });
        this.blobUrl = URL.createObjectURL(blob);
        worker = new Worker(this.blobUrl);
      } catch (err) {
        finish(() => reject(err instanceof Error ? err : new Error(String(err))));
        return;
      }
      this.worker = worker;

      worker.onmessage = (event: MessageEvent<WorkerToHostMessage>) => {
        const msg = event.data;
        if (!msg || typeof msg !== "object") return;
        switch (msg.type) {
          case "ready":
            finish(() => resolve({ manifest: msg.manifest, contributions: msg.contributions }));
            break;
          case "load-error":
            finish(() => {
              this.kill();
              reject(new Error(msg.message));
            });
            break;
          case "log":
            this.pushLog(`[${msg.level}] ${msg.args.join(" ")}`);
            break;
          case "result": {
            const pending = this.take(msg.callId);
            pending?.resolve(msg.value);
            break;
          }
          case "error": {
            const pending = this.take(msg.callId);
            pending?.reject(new Error(msg.message));
            break;
          }
        }
      };

      // A syntax error in the plugin body never reaches our try/catch inside
      // the worker — the script fails to parse at all and surfaces here.
      worker.onerror = (event: ErrorEvent) => {
        const message = event.message || "plugin script failed to load";
        finish(() => {
          this.kill();
          reject(new Error(message));
        });
        this.failAll(new Error(message));
      };
    });

    return this.loading;
  }

  async invoke(kind: ContributionKind, id: string, input: InvokeInput, context: InvokeContext): Promise<InvokeResult> {
    if (this.disposed) throw new Error("plugin host disposed");
    await this.load();
    const worker = this.worker;
    if (!worker) throw new Error("plugin worker is not running");

    const callId = this.nextCallId++;
    return new Promise<InvokeResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        // An unresponsive worker can only be stopped by killing it; drop the
        // handle so the next call rebuilds a fresh one.
        this.kill();
        reject(new Error(`plugin call timed out after ${INVOKE_TIMEOUT_MS}ms`));
      }, INVOKE_TIMEOUT_MS);
      this.pending.set(callId, { resolve, reject, timer });
      const message: HostToWorkerMessage = { type: "invoke", callId, kind, id, input, context };
      worker.postMessage(message);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.kill();
  }

  private take(callId: number): Pending | undefined {
    const pending = this.pending.get(callId);
    if (!pending) return undefined;
    clearTimeout(pending.timer);
    this.pending.delete(callId);
    return pending;
  }

  private failAll(error: Error): void {
    for (const [callId] of this.pending) this.take(callId)?.reject(error);
  }

  private pushLog(line: string): void {
    this.logs.push(line);
    if (this.logs.length > MAX_LOG_LINES) this.logs.shift();
    this.onLog?.(line);
  }

  /** Tears the worker down and forgets the load promise, so `load()` rebuilds it. */
  private kill(): void {
    this.worker?.terminate();
    this.worker = null;
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    this.loading = null;
  }
}
