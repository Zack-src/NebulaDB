import { useState, type KeyboardEvent } from "react";

export interface DraftValueOptions {
  /** When true an emptied field commits as "cleared" instead of reverting (notes, defaults). */
  allowEmpty?: boolean;
}

export interface DraftValueHandle {
  value: string;
  setValue: (next: string) => void;
  /** Commits if the trimmed draft actually differs; reverts otherwise. */
  commit: (override?: string) => void;
  /** Spread onto the input: Enter commits. */
  handleKeyDown: (event: KeyboardEvent) => void;
}

/**
 * A text input bound to a value owned elsewhere (a shared Yjs document).
 *
 * The property editors each carried four hand-written copies of this — a draft
 * state, a re-seed when the underlying entity changed, and a commit that
 * trimmed and compared before writing. They disagreed on the empty case, which
 * is why some fields could be blanked and others silently reverted.
 */
export function useDraftValue(
  currentValue: string,
  onCommit: (next: string | undefined) => void,
  options: DraftValueOptions = {},
): DraftValueHandle {
  const [value, setValue] = useState(currentValue);
  const [seededFrom, setSeededFrom] = useState(currentValue);

  // Re-seed when the value changes underneath us (a DBML edit, a remote
  // change). Adjusted during render — React's documented pattern — rather than
  // from an effect, so no frame ever shows the stale draft.
  if (currentValue !== seededFrom) {
    setSeededFrom(currentValue);
    setValue(currentValue);
  }

  const commit = (override?: string) => {
    const next = (override ?? value).trim();
    if (next === currentValue) return;
    if (!next && !options.allowEmpty) {
      setValue(currentValue);
      return;
    }
    onCommit(next || undefined);
  };

  return {
    value,
    setValue,
    commit,
    handleKeyDown: (event: KeyboardEvent) => {
      if (event.key === "Enter") commit();
    },
  };
}
