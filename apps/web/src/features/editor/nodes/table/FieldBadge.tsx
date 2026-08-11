import { KeyIcon, LinkIcon } from "@/components/icons/Icons";

/**
 * The leading per-row icon, showing the column's *role*: key (PK) > link (FK) >
 * blank. Attributes (unique / not null / increment / note) are the trailing
 * badge group in `TableNodeRow` — `unique` used to appear here too, which drew
 * the same diamond twice on any unique column.
 */
export function FieldBadge({ isForeignKey, isPk }: { isForeignKey: boolean; isPk: boolean }) {
  if (isPk) return <KeyIcon size={16} className="h-4 w-4 shrink-0 text-warning" />;
  if (isForeignKey) return <LinkIcon size={16} className="h-4 w-4 shrink-0 text-text-muted" />;
  return <span className="flex h-4 w-4 shrink-0" />;
}
