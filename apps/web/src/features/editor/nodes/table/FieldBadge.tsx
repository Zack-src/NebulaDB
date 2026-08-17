import { KeyIcon, LinkIcon } from "@/components/icons/Icons";

/**
 * The column's *role* icon: key (PK) > link (FK) > nothing. Rendered as the
 * leading member of `TableNodeRow`'s trailing badge group, alongside the
 * attribute badges (unique / not null / increment / note), so a column's
 * whole set of indicators reads as one tight cluster instead of the role
 * icon sitting off on its own next to the name — `unique` used to appear
 * here too, which drew the same diamond twice on any unique column.
 */
export function FieldBadge({ isForeignKey, isPk }: { isForeignKey: boolean; isPk: boolean }) {
  if (isPk) return <KeyIcon size={16} className="h-4 w-4 shrink-0 text-warning" />;
  if (isForeignKey) return <LinkIcon size={16} className="h-4 w-4 shrink-0 text-text-muted" />;
  return null;
}
