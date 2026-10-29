/**
 * Turns "this is going on" into "show it": true only once `active` has stayed true for `delayMs`, and then
 * for at least `minVisibleMs` even if the work ends sooner. A loading indicator that appears for a blink, or
 * that vanishes the moment it is noticed, is worse than none; one that only shows for work that is
 * actually slow tells the user something.
 */
export function useDelayedFlag(
  active: () => boolean,
  { delayMs, minVisibleMs = 400 }: { delayMs: number; minVisibleMs?: number },
): { readonly visible: boolean } {
  let visible = $state(false);

  $effect(() => {
    if (!active()) return;
    let shownAt = 0;
    const timer = setTimeout(() => {
      shownAt = performance.now();
      visible = true;
    }, delayMs);
    return () => {
      clearTimeout(timer);
      if (!shownAt) return;
      const remaining = minVisibleMs - (performance.now() - shownAt);
      if (remaining <= 0) visible = false;
      else setTimeout(() => (visible = false), remaining);
    };
  });

  return {
    get visible() {
      return visible;
    },
  };
}
