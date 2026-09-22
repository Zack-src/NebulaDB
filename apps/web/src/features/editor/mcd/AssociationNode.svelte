<script lang="ts">
  import { Handle, Position, type NodeProps } from "@xyflow/svelte";
  import { prefersDarkText } from "@/utils/color";
  import { DEFAULT_HEADER_COLOR, ROW_TYPE_CLASS, TABLE_NODE_CLASS } from "@/features/editor/nodes/table/tableStyles";
  import type { AssociationNodeType } from "./mcdNodes";

  /**
   * MCD association — the Merise diamond, rendered with the same box chrome as
   * `TableNode`/`EntityNode` (rounded-full instead of rounded-sm is the one
   * deliberate difference, to still read as "not an entity" at a glance) and
   * the junction table's own colour when it came from one, rather than an
   * unrelated flat purple that had nothing to do with the rest of the diagram.
   */
  let { data }: NodeProps<AssociationNodeType> = $props();

  const headerColor = $derived(data.sourceTable?.style?.color ?? DEFAULT_HEADER_COLOR);
</script>

<div class={`${TABLE_NODE_CLASS} rounded-full!`}>
  <Handle type="target" position={Position.Left} style="opacity: 0" />
  <Handle type="source" position={Position.Right} style="opacity: 0" />
  <div
    class="flex h-[calc(30px_*_var(--canvas-font-scale))] items-center justify-center px-3 text-[calc(13px_*_var(--canvas-font-scale))] font-semibold italic"
    style:background={headerColor}
    style:color={prefersDarkText(headerColor) ? "var(--color-text-on-light)" : "#ffffff"}
  >
    {data.association.name}
  </div>
  {#each data.association.attributes as attr (attr.id)}
    <div
      class="flex h-[calc(24px_*_var(--canvas-font-scale))] items-center justify-center gap-1.5 whitespace-nowrap border-t border-border px-3"
    >
      <span class="overflow-hidden text-ellipsis text-text-secondary">{attr.name}</span>
      <span class={ROW_TYPE_CLASS}>{attr.domain}</span>
    </div>
  {/each}
</div>
