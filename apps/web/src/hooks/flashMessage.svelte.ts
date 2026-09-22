/**
 * A transient status line: `flash("...")` shows it, and it clears itself
 * after `durationMs`. A second call replaces the first outright (the timer
 * resets) rather than being wiped by the first message's own expiry — two
 * unrelated events can legitimately produce the same text, so comparing the
 * message itself wouldn't be enough to tell "still the first one" from "a new
 * one that happens to read the same".
 *
 * Shared by the DBML editor's plugin-command status line and the canvas's.
 */
export function useFlashMessage(durationMs: number) {
  let message = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => () => {
    if (timer) clearTimeout(timer);
  });

  return {
    get message() {
      return message;
    },
    flash: (text: string) => {
      if (timer) clearTimeout(timer);
      message = text;
      timer = setTimeout(() => {
        message = null;
      }, durationMs);
    },
  };
}
