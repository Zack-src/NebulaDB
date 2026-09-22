<script lang="ts">
  import { Handle, Position, type NodeProps } from "@xyflow/svelte";
  import { prefersDarkText } from "@/utils/color";
  import {
    DEFAULT_HEADER_COLOR,
    ROW_TYPE_CLASS,
    TABLE_HEADER_CLASS,
    TABLE_NAME_CLASS,
    TABLE_NODE_CLASS,
  } from "@/features/editor/nodes/table/tableStyles";
  import type { EntityNodeType } from "./mcdNodes";

  /**
   * MCD entity box — same box chrome as `TableNode` (header colour, borders,
   * row sizing) so switching MLD/MCD reads as "the same schema, different
   * lens" rather than landing in an unrelated-looking canvas. What's
   * intentionally missing is MLD-specific: no PK/FK badges, no detail-level
   * switch, nothing editable — an MCD entity has no notion of a foreign key
   * (that's what the association next to it represents), so its attribute
   * list is already the FK-stripped one `deriveMCD` produced.
   */
  let { data }: NodeProps<EntityNodeType> = $props();

  const headerColor = $derived(data.sourceTable?.style?.color ?? DEFAULT_HEADER_COLOR);
</script>

<div class={`${TABLE_NODE_CLASS} ${data.hasWarning ? "border-warning" : ""}`}>
  <Handle type="target" position={Position.Left} style="opacity: 0" />
  <Handle type="source" position={Position.Right} style="opacity: 0" />
  <div
    class={TABLE_HEADER_CLASS}
    style:background={headerColor}
    style:color={prefersDarkText(headerColor) ? "var(--color-text-on-light)" : "#ffffff"}
  >
    <span class={TABLE_NAME_CLASS}>{data.entity.name}</span>
    {#if data.hasWarning}
      <span
        class="ml-auto shrink-0 text-[11px]"
        data-tooltip="Cette table peut cacher une association non reconstruite — voir l'avertissement"
      >
        ⚠
      </span>
    {/if}
  </div>
  {#each data.entity.attributes as attr (attr.id)}
    <div class="flex h-[calc(27px_*_var(--canvas-font-scale))] items-center gap-1.5 whitespace-nowrap border-t border-border px-2.5">
      <span class="overflow-hidden text-ellipsis font-medium text-text">{attr.name}</span>
      <span class={`ml-auto ${ROW_TYPE_CLASS}`}>{attr.domain}</span>
    </div>
  {/each}
</div>
