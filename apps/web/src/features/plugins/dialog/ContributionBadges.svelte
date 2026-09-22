<script lang="ts" module>
  import type { ContributionKind } from "@/features/plugins/types";

  const KIND_LABELS: Record<ContributionKind, { label: string; color: string }> = {
    exporter: { label: "Export", color: "bg-accent-cyan/15 text-accent-cyan border-accent-cyan/30" },
    importer: { label: "Import", color: "bg-accent-teal/15 text-accent-teal border-accent-teal/30" },
    canvasCommand: { label: "Canvas", color: "bg-primary/15 text-primary border-primary/30" },
    editorCommand: { label: "Éditeur", color: "bg-accent-orange/15 text-accent-orange border-accent-orange/30" },
  };
</script>

<script lang="ts">
  import type { Contribution } from "@/features/plugins/types";

  let { contributions }: { contributions: Contribution[] } = $props();

  const counts = $derived.by(() => {
    const result: Partial<Record<ContributionKind, number>> = {};
    for (const c of contributions) result[c.kind] = (result[c.kind] ?? 0) + 1;
    return result;
  });
</script>

<div class="flex flex-wrap gap-1.5 mt-2">
  {#each Object.keys(counts) as ContributionKind[] as kind (kind)}
    <span
      class={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-medium border ${KIND_LABELS[kind].color}`}
    >
      <span>{KIND_LABELS[kind].label}</span>
      <span class="opacity-75 font-mono text-[9.5px]">({counts[kind] ?? 0})</span>
    </span>
  {/each}
</div>
