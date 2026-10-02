import { readJson, writeJson } from "@/utils/storage";

/**
 * Everything the DBML editor does *on its own* — the edits the user did not
 * type. Each one is listed in the editor's settings popover and can be turned
 * off; none of them rewrites the buffer silently.
 */
export interface DbmlBehaviourPrefs {
  /** Reformat the document on Ctrl+S. The "Format" button and Shift+Alt+F work either way. */
  formatMode: "never" | "onSave";
  /** Open the completion list while typing. Off: only on demand (Ctrl+I / Ctrl+Space). */
  autoComplete: boolean;
  /** Insert the closing bracket/quote when the opening one is typed. */
  closeBrackets: boolean;
  /** Pause after the last keystroke before the buffer is sent to the diagram. `0`: only on Ctrl+S. */
  syncDelayMs: number;
}

export const SYNC_DELAY_CHOICES = [400, 600, 1000, 2000, 0] as const;

const PREF_BEHAVIOUR = "athanordb_dbml_behaviour";

const DEFAULTS: DbmlBehaviourPrefs = { formatMode: "never", autoComplete: true, closeBrackets: true, syncDelayMs: 600 };

/** Stored values are untrusted (hand-edited, or written by another version): anything unexpected falls back to its default. */
export function sanitizeBehaviourPrefs(stored: unknown): DbmlBehaviourPrefs {
  const raw = (stored && typeof stored === "object" ? stored : {}) as Partial<
    Record<keyof DbmlBehaviourPrefs, unknown>
  >;
  return {
    formatMode: raw.formatMode === "onSave" ? "onSave" : DEFAULTS.formatMode,
    autoComplete: typeof raw.autoComplete === "boolean" ? raw.autoComplete : DEFAULTS.autoComplete,
    closeBrackets: typeof raw.closeBrackets === "boolean" ? raw.closeBrackets : DEFAULTS.closeBrackets,
    syncDelayMs: (SYNC_DELAY_CHOICES as readonly unknown[]).includes(raw.syncDelayMs)
      ? (raw.syncDelayMs as number)
      : DEFAULTS.syncDelayMs,
  };
}

/** One shared instance: the panel (sync delay), the editor (compartments) and the status bar (settings) all read it. */
export const behaviourPrefs = $state(sanitizeBehaviourPrefs(readJson(PREF_BEHAVIOUR)));

export function updateBehaviourPrefs(patch: Partial<DbmlBehaviourPrefs>): void {
  Object.assign(behaviourPrefs, sanitizeBehaviourPrefs({ ...behaviourPrefs, ...patch }));
  writeJson(PREF_BEHAVIOUR, behaviourPrefs);
}
