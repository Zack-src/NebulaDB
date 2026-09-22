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
 * A text input bound to a value owned elsewhere (a shared Yjs document).
 *
 * The property editors each carried hand-written copies of this — a draft
 * state, a re-seed when the underlying entity changed, and a commit that
 * trimmed and compared before writing. They disagreed on the empty case, which
 * is why some fields could be blanked and others silently reverted.
 *
 * The draft re-seeds itself whenever the underlying value changes (a DBML
 * edit, a remote change): it is a writable `$derived` of the source string, so
 * an assignment overrides it until the source moves again. The source is its
 * own `$derived` on purpose — it only notifies the draft when the *string*
 * changes, so a collaborator editing another column of the same table (a new
 * `table` object, same name) doesn't wipe what the user is typing.
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
