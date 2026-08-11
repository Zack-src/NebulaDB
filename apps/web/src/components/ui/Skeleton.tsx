/**
 * Placeholder blocks shown while first-load data is in flight.
 *
 * The problem this solves isn't cosmetic. Lists here derive "empty" from an
 * array being empty, and an array is also empty before its fetch resolves — so
 * a user with twenty projects was briefly told they had none, then watched the
 * message be replaced. A wrong statement is worse than a blank space; these
 * make the difference between "nothing here" and "not known yet" visible.
 *
 * `aria-hidden` because there is nothing to read: the live region that matters
 * is the content that replaces it.
 */
export function Skeleton(props: { className?: string }) {
  return <div aria-hidden className={`animate-pulse-subtle rounded-md bg-surface-hover ${props.className ?? ""}`} />;
}

/** A card-shaped placeholder matching `ProjectCard`'s footprint, so the grid doesn't jump when real data lands. */
export function SkeletonCard() {
  return (
    <div aria-hidden className="rounded-xl border border-border/60 bg-surface/60 p-3">
      <Skeleton className="mb-3 h-[104px] w-full" />
      <Skeleton className="mb-2 h-3.5 w-3/4" />
      <Skeleton className="h-3 w-1/3" />
    </div>
  );
}

/** `count` card placeholders in the same grid the real cards use. */
export function SkeletonCardGrid(props: { count?: number }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
      {Array.from({ length: props.count ?? 4 }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
