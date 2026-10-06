export type ToastTone = "info" | "success" | "warning" | "danger";

interface ToastAction {
  label: string;
  run: () => void;
}

interface ToastOptions {
  tone?: ToastTone;
  /** One button on the toast — "Annuler" after a delete, "Voir" after an import. Running it dismisses the toast. */
  action?: ToastAction;
  /** `0` keeps it until dismissed. Defaults to 4 s, 8 s when there is an action to reach. */
  durationMs?: number;
}

interface ToastEntry {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
  durationMs: number;
}

const DEFAULT_DURATION_MS = 4_000;
const ACTION_DURATION_MS = 8_000;
/** Older toasts are dropped past this: a burst of events must not bury the page. */
const MAX_VISIBLE = 4;

/**
 * The app's one stack of transient messages, rendered by `ToastHost`.
 *
 * Module-level state, like `i18n`: a toast is raised from wherever the event
 * happens (a service call, a keyboard shortcut handler) and has to outlive the
 * component that raised it — the dialog that just closed, the row that was
 * just deleted.
 */
class ToastState {
  entries = $state<ToastEntry[]>([]);
  private nextId = 1;
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  show = (message: string, options: ToastOptions = {}): number => {
    const entry: ToastEntry = {
      id: this.nextId++,
      message,
      tone: options.tone ?? "info",
      action: options.action,
      durationMs: options.durationMs ?? (options.action ? ACTION_DURATION_MS : DEFAULT_DURATION_MS),
    };
    for (const dropped of this.entries.slice(0, Math.max(0, this.entries.length + 1 - MAX_VISIBLE))) {
      this.dismiss(dropped.id);
    }
    this.entries.push(entry);
    this.arm(entry);
    return entry.id;
  };

  info = (message: string, options?: Omit<ToastOptions, "tone">) => this.show(message, { ...options, tone: "info" });
  success = (message: string, options?: Omit<ToastOptions, "tone">) =>
    this.show(message, { ...options, tone: "success" });
  warning = (message: string, options?: Omit<ToastOptions, "tone">) =>
    this.show(message, { ...options, tone: "warning" });
  error = (message: string, options?: Omit<ToastOptions, "tone">) => this.show(message, { ...options, tone: "danger" });

  dismiss = (id: number): void => {
    this.disarm(id);
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index !== -1) this.entries.splice(index, 1);
  };

  /** Stops every countdown — while the pointer or the keyboard focus is on the stack. */
  pause = (): void => {
    for (const id of [...this.timers.keys()]) this.disarm(id);
  };

  /** Restarts the countdowns from their full duration: the user was just reading. */
  resume = (): void => {
    for (const entry of this.entries) this.arm(entry);
  };

  private arm(entry: ToastEntry): void {
    if (entry.durationMs <= 0 || this.timers.has(entry.id)) return;
    this.timers.set(
      entry.id,
      setTimeout(() => this.dismiss(entry.id), entry.durationMs),
    );
  }

  private disarm(id: number): void {
    const timer = this.timers.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.timers.delete(id);
  }
}

export const toast = new ToastState();
