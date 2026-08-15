import type { ContributionKind, Contribution } from "@/features/plugins/types";

export function ContributionBadges({ contributions }: { contributions: Contribution[] }) {
  const counts: Partial<Record<ContributionKind, number>> = {};
  for (const c of contributions) {
    counts[c.kind] = (counts[c.kind] ?? 0) + 1;
  }

  const kindLabels: Record<ContributionKind, { label: string; color: string }> = {
    exporter: { label: "Export", color: "bg-accent-cyan/15 text-accent-cyan border-accent-cyan/30" },
    importer: { label: "Import", color: "bg-accent-teal/15 text-accent-teal border-accent-teal/30" },
    canvasCommand: { label: "Canvas", color: "bg-primary/15 text-primary border-primary/30" },
    editorCommand: { label: "Éditeur", color: "bg-accent-orange/15 text-accent-orange border-accent-orange/30" },
  };

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {(Object.keys(counts) as ContributionKind[]).map((kind) => {
        const info = kindLabels[kind];
        const count = counts[kind] ?? 0;
        return (
          <span
            key={kind}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-medium border ${info.color}`}
          >
            <span>{info.label}</span>
            <span className="opacity-75 font-mono text-[9.5px]">({count})</span>
          </span>
        );
      })}
    </div>
  );
}
