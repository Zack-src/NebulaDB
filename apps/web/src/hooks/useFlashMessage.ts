import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A transient status line: `flash("...")` shows it, and it clears itself
 * after `durationMs`. A second call replaces the first outright (the timer
 * resets) rather than being wiped by the first message's own expiry — two
 * unrelated events can legitimately produce the same text, so comparing the
 * message itself wouldn't be enough to tell "still the first one" from "a new
 * one that happens to read the same".
 *
 * Shared by the DBML editor's plugin-command status line and the canvas's —
 * previously two independent copies of the same state/timer/cleanup, one per
 * file.
 */
export function useFlashMessage(durationMs: number) {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback(
    (text: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setMessage(text);
      timerRef.current = setTimeout(() => setMessage(null), durationMs);
    },
    [durationMs],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { message, flash };
}
