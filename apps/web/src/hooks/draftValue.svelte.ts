export interface DraftValueOptions {
  /** When true an emptied field commits as "cleared" instead of reverting (notes, defaults). */
  allowEmpty?: boolean;
}

export interface DraftValueHandle {
  value: string;
  setValue: (next: string) => void;
  /** Commits if the trimmed draft actually differs; reverts otherwise. */
  commit: (override?: string) => void;
  /** Wire to the input's `onkeydown`: Enter commits. */
  handleKeyDown: (event: KeyboardEvent) => void;
}

/**
 * A text input bound to a value owned elsewhere (a shared Yjs document): a draft that re-seeds
 * when the underlying value changes (a DBML edit, a remote change), and a commit that trims and
 * compares before writing. The draft is a writable `$derived` of a source `$derived` string, so
 * a collaborator editing another column of the same table doesn't wipe what the user types.
 */
export function useDraftValue(
  current: () => string,
  onCommit: (next: string | undefined) => void,
  options: DraftValueOptions = {},
): DraftValueHandle {
  const source = $derived(current());
  let value = $derived(source);

  const commit = (override?: string) => {
    const next = (override ?? value).trim();
    if (next === source) return;
    if (!next && !options.allowEmpty) {
      value = source;
      return;
    }
    onCommit(next || undefined);
  };

  return {
    get value() {
      return value;
    },
    set value(next: string) {
      value = next;
    },
    setValue: (next) => {
      value = next;
    },
    commit,
    handleKeyDown: (event) => {
      if (event.key === "Enter") commit();
    },
  };
}
